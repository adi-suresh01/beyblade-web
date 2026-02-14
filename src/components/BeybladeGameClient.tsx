"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ArenaCanvas } from "@/components/ArenaCanvas";
import { BEYBLADE_LIST, BEYBLADES } from "@/lib/game/beyblades";
import {
  emitArenaLog,
  sendArenaCommand,
  sendArenaConfig,
  sendArenaReset,
  subscribeArenaLog,
  subscribeArenaState,
  subscribeTauntRequest
} from "@/lib/game/arenaBus";
import { ArenaConfig, BeybladeId, Difficulty, TauntRequest } from "@/lib/game/types";
import { useSpeechCommand } from "@/lib/voice/useSpeechCommand";
import { useSpeechPhrase } from "@/lib/voice/useSpeechPhrase";
import { speakText } from "@/lib/voice/tts";
import { useGameStore } from "@/store/gameStore";

const PLAYER_VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_PLAYER_VOICE_ID || "";
const AI_VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AI_VOICE_ID || "";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const COUNTDOWN_START = 3;

type MatchPhase =
  | "intro"
  | "blade-select"
  | "difficulty-select"
  | "countdown"
  | "await-launch"
  | "battle";

function makeId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function pickRandomAiBlade(playerBlade: BeybladeId): BeybladeId {
  const options = BEYBLADE_LIST.map((blade) => blade.id).filter((id) => id !== playerBlade);
  return options[Math.floor(Math.random() * options.length)] || "driger";
}

function bladeStyle(color: string): CSSProperties {
  return { "--blade-color": color } as CSSProperties;
}

async function fetchRoast(payload: {
  playerText: string;
  playerBlade: BeybladeId;
  aiBlade: BeybladeId;
  context?: string;
}): Promise<string> {
  const response = await fetch("/api/trash-talk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return "You couldn't even trigger a proper comeback. That's almost impressive.";
  }

  const json = (await response.json()) as { roast?: string };
  return json.roast || "That line hit softer than your launch.";
}

function mapTauntTriggerToPrompt(trigger: TauntRequest["trigger"]): string {
  switch (trigger) {
    case "ai-hit":
      return "Roast me after you landed a hit.";
    case "ai-dodge":
      return "Roast me after dodging my attack.";
    case "ai-bit-beast":
      return "Roast me after your bit beast attack.";
    case "player-miss":
      return "Roast me after I lost the match.";
    default:
      return "Roast me in one sharp line.";
  }
}

export function BeybladeGameClient() {
  const arena = useGameStore((state) => state.arena);
  const logs = useGameStore((state) => state.logs);
  const setArena = useGameStore((state) => state.setArena);
  const pushLog = useGameStore((state) => state.pushLog);
  const clearLogs = useGameStore((state) => state.clearLogs);

  const [playerBlade, setPlayerBlade] = useState<BeybladeId>("dragoon");
  const [aiBlade, setAiBlade] = useState<BeybladeId>("driger");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [matchPhase, setMatchPhase] = useState<MatchPhase>("intro");
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [manualTrash, setManualTrash] = useState("");
  const [isTalking, setIsTalking] = useState(false);
  const trashProcessingRef = useRef(false);

  const inBattle = matchPhase === "battle";
  const inLaunchSequence = matchPhase === "countdown" || matchPhase === "await-launch";

  const currentConfig: ArenaConfig = useMemo(
    () => ({ playerBlade, aiBlade, difficulty }),
    [aiBlade, difficulty, playerBlade]
  );

  useEffect(() => {
    sendArenaConfig(currentConfig);
  }, [currentConfig]);

  const handleLaunchConfirmed = useCallback(() => {
    clearLogs();
    emitArenaLog({
      id: makeId(),
      speaker: "system",
      kind: "combat",
      text: "LET IT RIP!",
      timestamp: Date.now()
    });
    setMatchPhase("battle");
  }, [clearLogs]);

  const {
    supported: launchSupported,
    isListening: isLaunchListening,
    lastTranscript: launchTranscript,
    error: launchError,
    start: startLaunchListening,
    stop: stopLaunchListening
  } = useSpeechPhrase({
    phrase: "let it rip",
    onMatch: () => {
      handleLaunchConfirmed();
    }
  });

  const maybeSpeak = useCallback(async (speaker: "player" | "ai", text: string) => {
    const voiceId = speaker === "player" ? PLAYER_VOICE_ID : AI_VOICE_ID;
    if (!voiceId) {
      return;
    }
    await speakText({ text, voiceId });
  }, []);

  const triggerAiRoast = useCallback(
    async (playerText: string, context?: string) => {
      setIsTalking(true);
      try {
        const roast =
          (await fetchRoast({
            playerText,
            playerBlade,
            aiBlade,
            context
          }).catch(() => null)) ||
          "Your game plan fell apart before your sentence ended.";

        emitArenaLog({
          id: makeId(),
          kind: "trash",
          speaker: "ai",
          text: roast,
          timestamp: Date.now()
        });

        await maybeSpeak("ai", roast).catch(() => undefined);
      } finally {
        setIsTalking(false);
      }
    },
    [aiBlade, maybeSpeak, playerBlade]
  );

  const handlePlayerTrashTalk = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || !inBattle || isTalking || trashProcessingRef.current) {
        return;
      }

      trashProcessingRef.current = true;
      try {
        emitArenaLog({
          id: makeId(),
          kind: "trash",
          speaker: "player",
          text: clean,
          timestamp: Date.now()
        });

        await maybeSpeak("player", clean).catch(() => undefined);
        await triggerAiRoast(clean, "Respond to player trash talk.");
      } finally {
        trashProcessingRef.current = false;
      }
    },
    [inBattle, isTalking, maybeSpeak, triggerAiRoast]
  );

  useEffect(() => {
    const offState = subscribeArenaState((state) => {
      setArena(state);
    });

    const offLog = subscribeArenaLog((log) => {
      pushLog(log);
    });

    const offTaunt = subscribeTauntRequest((request) => {
      if (!inBattle) {
        return;
      }
      void triggerAiRoast(mapTauntTriggerToPrompt(request.trigger));
    });

    return () => {
      offState();
      offLog();
      offTaunt();
    };
  }, [inBattle, pushLog, setArena, triggerAiRoast]);

  const { supported, isListening, lastTranscript, error, start, stop } = useSpeechCommand({
    onCommand: (command) => {
      if (!inBattle) {
        return;
      }
      emitArenaLog({
        id: makeId(),
        kind: "combat",
        speaker: "system",
        text: `Voice: ${command.toUpperCase()}`,
        timestamp: Date.now()
      });
      sendArenaCommand(command);
    },
    onTrashTalk: (text) => {
      if (!inBattle || isTalking || trashProcessingRef.current) {
        return;
      }
      void handlePlayerTrashTalk(text);
    }
  });

  const resetToIntro = useCallback(() => {
    stop();
    stopLaunchListening();
    clearLogs();
    setManualTrash("");
    setCountdown(COUNTDOWN_START);
    setMatchPhase("intro");
  }, [clearLogs, stop, stopLaunchListening]);

  const startLaunchSequence = useCallback(() => {
    stop();
    stopLaunchListening();
    clearLogs();
    setManualTrash("");
    setAiBlade(pickRandomAiBlade(playerBlade));
    setCountdown(COUNTDOWN_START);
    setMatchPhase("countdown");
  }, [clearLogs, playerBlade, stop, stopLaunchListening]);

  useEffect(() => {
    if (matchPhase !== "countdown") {
      return;
    }

    if (countdown <= 0) {
      setMatchPhase("await-launch");
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((value) => value - 1);
    }, 820);

    return () => {
      window.clearTimeout(timer);
    };
  }, [countdown, matchPhase]);

  useEffect(() => {
    if (matchPhase !== "await-launch") {
      stopLaunchListening();
      return;
    }

    if (launchSupported && !isLaunchListening) {
      startLaunchListening();
    }
  }, [
    isLaunchListening,
    launchSupported,
    matchPhase,
    startLaunchListening,
    stopLaunchListening
  ]);

  useEffect(() => {
    if (!inBattle && isListening) {
      stop();
    }
  }, [inBattle, isListening, stop]);

  useEffect(() => {
    if (!inBattle) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "a") {
        emitArenaLog({
          id: makeId(),
          kind: "combat",
          speaker: "system",
          text: "Key: ATTACK",
          timestamp: Date.now()
        });
        sendArenaCommand("attack");
      } else if (key === "d") {
        emitArenaLog({
          id: makeId(),
          kind: "combat",
          speaker: "system",
          text: "Key: DODGE",
          timestamp: Date.now()
        });
        sendArenaCommand("dodge");
      } else if (key === "b") {
        emitArenaLog({
          id: makeId(),
          kind: "combat",
          speaker: "system",
          text: "Key: BIT-BEAST",
          timestamp: Date.now()
        });
        sendArenaCommand("bit-beast");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inBattle]);

  return (
    <main className={`page phase-${matchPhase}`}>
      <section className="hero">
        <h1>Beyblade Voice Arena</h1>
      </section>

      {matchPhase === "intro" ? (
        <section className="panel intro-panel view-panel">
          <button className="start-button" onClick={() => setMatchPhase("blade-select")}>
            START
          </button>
          <div className="blade-preview-grid">
            {BEYBLADE_LIST.map((blade) => (
              <div key={blade.id} className="blade-preview-item">
                <div className="blade-wheel" style={bladeStyle(blade.color)}>
                  <Image
                    className="blade-image"
                    src={`/beyblades/${blade.id}.png`}
                    alt={blade.name}
                    width={90}
                    height={90}
                  />
                </div>
                <p>{blade.name}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {matchPhase === "blade-select" ? (
        <section className="panel selector-panel view-panel">
          <h2>Select Beyblade</h2>
          <div className="blade-select-grid">
            {BEYBLADE_LIST.map((blade) => {
              const selected = playerBlade === blade.id;
              return (
                <button
                  key={blade.id}
                  className={`blade-select-card ${selected ? "selected" : ""}`}
                  onClick={() => setPlayerBlade(blade.id)}
                  aria-pressed={selected}
                >
                  <div className="blade-wheel" style={bladeStyle(blade.color)}>
                    <Image
                      className="blade-image"
                      src={`/beyblades/${blade.id}.png`}
                      alt={blade.name}
                      width={90}
                      height={90}
                    />
                  </div>
                  <strong>{blade.name}</strong>
                  <span>{blade.bitBeast}</span>
                </button>
              );
            })}
          </div>
          <div className="flow-actions">
            <button className="secondary" onClick={() => setMatchPhase("intro")}>
              Back
            </button>
            <button onClick={() => setMatchPhase("difficulty-select")}>Next</button>
          </div>
        </section>
      ) : null}

      {matchPhase === "difficulty-select" ? (
        <section className="panel selector-panel view-panel">
          <h2>Select Difficulty</h2>
          <div className="difficulty-grid">
            {DIFFICULTIES.map((level) => {
              const selected = difficulty === level;
              return (
                <button
                  key={level}
                  className={`difficulty-card ${selected ? "selected" : ""}`}
                  onClick={() => setDifficulty(level)}
                  aria-pressed={selected}
                >
                  <strong>{level.toUpperCase()}</strong>
                </button>
              );
            })}
          </div>
          <div className="flow-actions">
            <button className="secondary" onClick={() => setMatchPhase("blade-select")}>
              Back
            </button>
            <button onClick={startLaunchSequence}>Start Match</button>
          </div>
        </section>
      ) : null}

      {inLaunchSequence ? (
        <section className="panel launch-panel view-panel">
          <h2>Launch</h2>
          <div className="launch-grid">
            <article className="trainer-card">
              <p className="trainer-tag">YOU</p>
              <h3>{BEYBLADES[playerBlade].name}</h3>
              <p className="blade-badge" style={{ borderColor: BEYBLADES[playerBlade].color }}>
                {BEYBLADES[playerBlade].bitBeast}
              </p>
              <div className="trainer-blade-mini">
                <Image
                  className="trainer-blade-image"
                  src={`/beyblades/${playerBlade}.png`}
                  alt={BEYBLADES[playerBlade].name}
                  width={74}
                  height={74}
                />
              </div>
              <div className="launcher-ui">
                <span className="launcher-body">Launcher</span>
                <span className="ripcord">Ripcord</span>
              </div>
            </article>

            <div className="launch-center">
              <p className="countdown-mark">
                {matchPhase === "countdown" && countdown > 0 ? countdown : "LET IT RIP"}
              </p>
              {matchPhase === "await-launch" ? (
                <>
                  <div className="launch-controls">
                    {launchSupported ? (
                      <button onClick={isLaunchListening ? stopLaunchListening : startLaunchListening}>
                        {isLaunchListening ? "Listening" : "Listen"}
                      </button>
                    ) : null}
                    <button className="secondary" onClick={handleLaunchConfirmed}>
                      Manual Launch
                    </button>
                  </div>
                  {launchTranscript ? <p className="muted">{launchTranscript}</p> : null}
                  {launchError ? <p className="error">{launchError}</p> : null}
                </>
              ) : null}
            </div>

            <article className="trainer-card trainer-card-ai">
              <p className="trainer-tag">AI</p>
              <h3>{BEYBLADES[aiBlade].name}</h3>
              <p className="blade-badge" style={{ borderColor: BEYBLADES[aiBlade].color }}>
                {BEYBLADES[aiBlade].bitBeast}
              </p>
              <div className="trainer-blade-mini">
                <Image
                  className="trainer-blade-image"
                  src={`/beyblades/${aiBlade}.png`}
                  alt={BEYBLADES[aiBlade].name}
                  width={74}
                  height={74}
                />
              </div>
              <div className="launcher-ui">
                <span className="launcher-body">Launcher</span>
                <span className="ripcord">Ripcord</span>
              </div>
            </article>
          </div>

          <div className="launch-footer">
            <button className="secondary" onClick={resetToIntro}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {inBattle ? (
        <>
          <section className="panel battle-head">
            <div className="battle-meta">
              <div>
                <span>You</span>
                <strong>{BEYBLADES[playerBlade].name}</strong>
              </div>
              <div>
                <span>AI</span>
                <strong>{BEYBLADES[aiBlade].name}</strong>
              </div>
              <div>
                <span>Difficulty</span>
                <strong>{difficulty.toUpperCase()}</strong>
              </div>
            </div>
            <div className="battle-head-actions">
              <button className="secondary" onClick={() => sendArenaReset()}>
                Replay
              </button>
              <button className="secondary" onClick={resetToIntro}>
                New Match
              </button>
            </div>
          </section>

          <section className="panel stats-panel">
            <div className="stat-row">
              <span>{BEYBLADES[playerBlade].name} HP</span>
              <strong>{arena.playerHp}</strong>
            </div>
            <div className="meter">
              <div style={{ width: `${arena.playerHp}%`, background: "#4bc084" }} />
            </div>

            <div className="stat-row">
              <span>{BEYBLADES[aiBlade].name} HP</span>
              <strong>{arena.aiHp}</strong>
            </div>
            <div className="meter">
              <div style={{ width: `${arena.aiHp}%`, background: "#ff5a7a" }} />
            </div>

            <div className="stat-row">
              <span>Your Bit Beast</span>
              <strong>{arena.playerBit}%</strong>
            </div>
            <div className="meter">
              <div style={{ width: `${arena.playerBit}%`, background: "#4bc3ff" }} />
            </div>

            <div className="stat-row">
              <span>AI Bit Beast</span>
              <strong>{arena.aiBit}%</strong>
            </div>
            <div className="meter">
              <div style={{ width: `${arena.aiBit}%`, background: "#ffd84d" }} />
            </div>
          </section>

          <section className="panel arena-panel">
            <ArenaCanvas />

            <div className="commands">
              <button onClick={() => sendArenaCommand("attack")}>Attack [A]</button>
              <button onClick={() => sendArenaCommand("dodge")}>Dodge [D]</button>
              <button onClick={() => sendArenaCommand("bit-beast")}>Bit Beast [B]</button>
            </div>
          </section>

          <section className="panel voice-panel">
            <div className="voice-controls">
              <button onClick={isListening ? stop : start} disabled={!supported}>
                {isListening ? "Stop Voice" : "Start Voice"}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  void triggerAiRoast("Talk back.", "Player requested roast");
                }}
                disabled={isTalking}
              >
                Provoke AI
              </button>
              <button className="secondary" onClick={clearLogs}>
                Clear Logs
              </button>
            </div>

            {lastTranscript ? <p className="muted">{lastTranscript}</p> : null}
            {error ? <p className="error">{error}</p> : null}

            <div className="manual-trash">
              <input
                placeholder="Type trash talk"
                value={manualTrash}
                onChange={(event) => setManualTrash(event.target.value)}
              />
              <button
                onClick={() => {
                  void handlePlayerTrashTalk(manualTrash);
                  setManualTrash("");
                }}
              >
                Send
              </button>
            </div>
          </section>

          <section className="panel logs-panel">
            <h2>Feed</h2>
            <ul>
              {logs.map((log) => (
                <li key={log.id}>
                  <strong>[{log.speaker.toUpperCase()}]</strong> {log.text}
                </li>
              ))}
              {!logs.length ? <li>No events yet.</li> : null}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
