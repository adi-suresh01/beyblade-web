"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type MatchPhase = "setup" | "countdown" | "await-launch" | "battle";

function makeId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function pickRandomAiBlade(playerBlade: BeybladeId): BeybladeId {
  const options = BEYBLADE_LIST.map((blade) => blade.id).filter((id) => id !== playerBlade);
  return options[Math.floor(Math.random() * options.length)] || "driger";
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
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [matchPhase, setMatchPhase] = useState<MatchPhase>("setup");
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [manualTrash, setManualTrash] = useState("");
  const [isTalking, setIsTalking] = useState(false);

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
      text: "LET IT RIP! Battle start.",
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
      if (!clean || !inBattle) {
        return;
      }

      emitArenaLog({
        id: makeId(),
        kind: "trash",
        speaker: "player",
        text: clean,
        timestamp: Date.now()
      });

      await maybeSpeak("player", clean).catch(() => undefined);
      await triggerAiRoast(clean, "Respond to player trash talk.");
    },
    [inBattle, maybeSpeak, triggerAiRoast]
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
      sendArenaCommand(command);
    },
    onTrashTalk: (text) => {
      if (!inBattle) {
        return;
      }
      void handlePlayerTrashTalk(text);
    }
  });

  const resetToSetup = useCallback(() => {
    stop();
    stopLaunchListening();
    clearLogs();
    setManualTrash("");
    setMatchPhase("setup");
    setCountdown(COUNTDOWN_START);
  }, [clearLogs, stop, stopLaunchListening]);

  const startMatch = useCallback(() => {
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
    }, 850);

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
    if (!inBattle) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "a") {
        sendArenaCommand("attack");
      } else if (key === "d") {
        sendArenaCommand("dodge");
      } else if (key === "b") {
        sendArenaCommand("bit-beast");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inBattle]);

  return (
    <main className="page">
      <section className="hero">
        <h1>Beyblade Voice Arena</h1>
        <p>
          Launch by voice, battle in real time, and trade ElevenLabs-powered trash talk with the AI.
        </p>
      </section>

      {matchPhase === "setup" ? (
        <section className="panel launch-panel">
          <h2>Match Setup</h2>
          <div className="config-panel setup-grid">
            <div>
              <label htmlFor="playerBlade">Your Blade</label>
              <select
                id="playerBlade"
                value={playerBlade}
                onChange={(event) => setPlayerBlade(event.target.value as BeybladeId)}
              >
                {BEYBLADE_LIST.map((blade) => (
                  <option key={blade.id} value={blade.id}>
                    {blade.name} - {blade.bitBeast}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="difficulty">Difficulty</label>
              <select
                id="difficulty"
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as Difficulty)}
              >
                {DIFFICULTIES.map((level) => (
                  <option key={level} value={level}>
                    {level.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <button onClick={startMatch}>Start Launch Sequence</button>
          </div>
          <p className="muted">
            AI selects a random different Beyblade when the launch sequence starts.
          </p>
        </section>
      ) : null}

      {inLaunchSequence ? (
        <section className="panel launch-panel">
          <h2>Launch Sequence</h2>
          <div className="launch-grid">
            <article className="trainer-card">
              <p className="trainer-tag">Player 1</p>
              <h3>You</h3>
              <p className="blade-badge" style={{ borderColor: BEYBLADES[playerBlade].color }}>
                {BEYBLADES[playerBlade].name}
              </p>
              <div className="launcher-ui">
                <span className="launcher-body">Launcher</span>
                <span className="ripcord">Ripcord Loaded</span>
              </div>
            </article>

            <div className="launch-center">
              <p className="countdown-mark">
                {matchPhase === "countdown" && countdown > 0 ? countdown : "LET IT RIP"}
              </p>
              {matchPhase === "countdown" ? (
                <p className="muted">3... 2... 1...</p>
              ) : (
                <>
                  <p className="muted">Say let it rip to launch the battle.</p>
                  <div className="launch-controls">
                    {launchSupported ? (
                      <button onClick={isLaunchListening ? stopLaunchListening : startLaunchListening}>
                        {isLaunchListening ? "Listening for phrase..." : "Listen for Let It Rip"}
                      </button>
                    ) : null}
                    <button className="secondary" onClick={handleLaunchConfirmed}>
                      Launch Manually
                    </button>
                  </div>
                  {launchTranscript ? (
                    <p className="muted">Launch transcript: {launchTranscript}</p>
                  ) : null}
                  {launchError ? <p className="error">Launch voice error: {launchError}</p> : null}
                </>
              )}
            </div>

            <article className="trainer-card trainer-card-ai">
              <p className="trainer-tag">Player 2</p>
              <h3>AI Rival</h3>
              <p className="blade-badge" style={{ borderColor: BEYBLADES[aiBlade].color }}>
                {BEYBLADES[aiBlade].name}
              </p>
              <div className="launcher-ui">
                <span className="launcher-body">Launcher</span>
                <span className="ripcord">Ripcord Loaded</span>
              </div>
            </article>
          </div>

          <div className="launch-footer">
            <button className="secondary" onClick={resetToSetup}>
              Cancel Launch
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
                Replay Match
              </button>
              <button className="secondary" onClick={resetToSetup}>
                New Setup
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

            <div className="winner">
              {arena.winner
                ? arena.winner === "player"
                  ? "Winner: You"
                  : "Winner: AI"
                : "In Match"}
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
                {isListening ? "Stop Voice Input" : "Start Voice Input"}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  void triggerAiRoast(
                    "Say something mean and confident.",
                    "Player requested a direct roast"
                  );
                }}
                disabled={isTalking}
              >
                Provoke AI Roast
              </button>
              <button className="secondary" onClick={clearLogs}>
                Clear Logs
              </button>
            </div>

            <p className="muted">
              Voice input supports both commands and trash talk. Commands: attack, dodge, bit
              beast.
            </p>
            {lastTranscript ? <p className="muted">Last transcript: {lastTranscript}</p> : null}
            {error ? <p className="error">Speech error: {error}</p> : null}

            <div className="manual-trash">
              <input
                placeholder="Type trash talk and send"
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
            <h2>Combat + Trash Talk Feed</h2>
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
