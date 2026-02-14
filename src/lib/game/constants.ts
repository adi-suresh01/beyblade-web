import { ArenaConfig } from "@/lib/game/types";

export const MAX_HP = 100;
export const MAX_BIT = 100;

export const DEFAULT_ARENA_CONFIG: ArenaConfig = {
  playerBlade: "dragoon",
  aiBlade: "driger",
  difficulty: "medium"
};

export const DIFFICULTY_AI_DODGE_CHANCE = {
  easy: 0.2,
  medium: 0.42,
  hard: 0.62
} as const;

export const DIFFICULTY_AI_ACTION_DELAY = {
  easy: 860,
  medium: 680,
  hard: 520
} as const;
