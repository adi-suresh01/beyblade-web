import { GameCommand } from "@/lib/game/types";

export type VoiceIntent =
  | { type: "command"; command: GameCommand }
  | { type: "trash"; text: string };

const COMMAND_PATTERNS: Array<{ regex: RegExp; command: GameCommand }> = [
  { regex: /\b(bit\s*beast|ultimate|special)\b/i, command: "bit-beast" },
  { regex: /\b(dodge|evade|sidestep|avoid)\b/i, command: "dodge" },
  { regex: /\b(attack|hit|strike|rush)\b/i, command: "attack" }
];

export function parseVoiceIntent(rawText: string): VoiceIntent {
  const text = rawText.trim();

  for (const entry of COMMAND_PATTERNS) {
    if (entry.regex.test(text)) {
      return { type: "command", command: entry.command };
    }
  }

  return { type: "trash", text };
}
