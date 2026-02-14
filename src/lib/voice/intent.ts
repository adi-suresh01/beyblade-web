import { GameCommand } from "@/lib/game/types";

export type VoiceIntent =
  | { type: "command"; command: GameCommand }
  | { type: "trash"; text: string };

interface CommandPattern {
  command: GameCommand;
  regexes: RegExp[];
}

const COMMAND_PATTERNS: CommandPattern[] = [
  {
    command: "bit-beast",
    regexes: [
      /\b(bit\s*beast|bitbeast|big\s*beast|beast\s*mode|ultimate|special)\b/i,
      /\b(beast\s*attack|finish\s*move|finisher)\b/i
    ]
  },
  {
    command: "dodge",
    regexes: [
      /\b(dodge|dodges|evade|sidestep|avoid|doge|dotch|dodj)\b/i,
      /\b(get\s*out|move\s*out|move\s*away)\b/i
    ]
  },
  {
    command: "attack",
    regexes: [
      /\b(attack|attacks|a\s*tack|atack|attak|strike|hit|rush|smash)\b/i,
      /\b(go\s*in|hit\s*now|full\s*attack)\b/i
    ]
  }
];

function normalizeText(rawText: string): string {
  return rawText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function fuzzySingleWordMatch(text: string, target: string, maxDistance: number): boolean {
  if (!text) {
    return false;
  }

  const words = text.split(" ");
  return words.some((word) => {
    if (!word) {
      return false;
    }
    return levenshteinDistance(word, target) <= maxDistance;
  });
}

function fuzzyBitBeastMatch(text: string): boolean {
  const words = text.split(" ").filter(Boolean);
  if (!words.length) {
    return false;
  }

  for (let i = 0; i < words.length; i += 1) {
    const isBitLike = levenshteinDistance(words[i], "bit") <= 1;
    if (!isBitLike) {
      continue;
    }

    for (let j = i + 1; j <= i + 2 && j < words.length; j += 1) {
      if (levenshteinDistance(words[j], "beast") <= 2) {
        return true;
      }
    }
  }

  return false;
}

export function parseVoiceIntent(rawText: string): VoiceIntent {
  const text = rawText.trim();
  const normalized = normalizeText(text);

  for (const entry of COMMAND_PATTERNS) {
    if (entry.regexes.some((regex) => regex.test(normalized))) {
      return { type: "command", command: entry.command };
    }
  }

  if (fuzzyBitBeastMatch(normalized)) {
    return { type: "command", command: "bit-beast" };
  }

  if (fuzzySingleWordMatch(normalized, "dodge", 2)) {
    return { type: "command", command: "dodge" };
  }

  if (fuzzySingleWordMatch(normalized, "attack", 2)) {
    return { type: "command", command: "attack" };
  }

  return { type: "trash", text };
}
