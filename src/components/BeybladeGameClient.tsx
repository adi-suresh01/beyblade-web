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
import { useGameStore } from "@/store/gameStore";
import { useSpeechCommand } from "@/lib/voice/useSpeechCommand";
import { speakText } from "@/lib/voice/tts";

const PLAYER_VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_PLAYER_VOICE_ID || "";
const AI_VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AI_VOICE_ID || "";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

function makeId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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
  const [manualTrash, setManualTrash] = useState("");
  const [isTalking, setIsTalking] = useState(false);

  const currentConfig: ArenaConfig = useMemo(
    () => ({ playerBlade, aiBlade, difficulty }),
    [aiBlade, difficulty, playerBlade]
  );

  useEffect(() => {
    const offState = subscribeArenaState((state) => {
      setArena(state);
    });

    const offLog = subscribeArenaLog((log) => {
      pushLog(log);
    });

    const offTaunt = subscribeTauntRequest((request) => {
      void triggerAiRoast(mapTauntTriggerToPrompt(request.trigger));
    });

    return () => {
      offState();
      offLog();
      offTaunt();
    };
  }, [pushLog, setArena]);

  useEffect(() => {
    sendArenaConfig(currentConfig);
  }, [currentConfig]);

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
      const roast = await fetchRoast({
        playerText,
        playerBlade,
        aiBlade,
        context
      });

      emitArenaLog({
        id: makeId(),
        kind: "trash",
        speaker: "ai",
        text: roast,
        timestamp: Date.now()
      });

      await maybeSpeak("ai", roast).catch(() => undefined);
      setIsTalking(false);
    },
    [aiBlade, maybeSpeak, playerBlade]
  );

  const handlePlayerTrashTalk = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) {
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
    [maybeSpeak, triggerAiRoast]
  );

  const { supported, isListening, lastTranscript, error, start, stop } = useSpeechCommand({
    onCommand: (command) => {
      sendArenaCommand(command);
    },
    onTrashTalk: (text) => {
      void handlePlayerTrashTalk(text);
    }
  });

  useEffect(() => {
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
  }, []);

  return (
    <main className="page">
      <section className="hero">
        <h1>Beyblade Voice Arena</h1>
        <p>
          Real-time 2D combat with voice commands, four classic blades, and dual-side ElevenLabs
          trash talk.
        </p>
      </section>

      <section className="panel config-panel">
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
          <label htmlFor="aiBlade">AI Blade</label>
          <select
            id="aiBlade"
            value={aiBlade}
            onChange={(event) => setAiBlade(event.target.value as BeybladeId)}
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

        <button className="secondary" onClick={() => sendArenaReset()}>
          Reset Match
        </button>
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
          {arena.winner ? (arena.winner === "player" ? "Winner: You" : "Winner: AI") : "In Match"}
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
              void triggerAiRoast("Say something mean and confident.", "Player requested a direct roast");
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
          Voice input supports both commands and trash talk. Commands: "attack", "dodge", "bit
          beast".
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
    </main>
  );
}
