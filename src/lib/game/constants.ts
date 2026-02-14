import { ArenaConfig } from "@/lib/game/types";

export const MAX_HP = 100;
export const MAX_BIT = 100;

export const DEFAULT_ARENA_CONFIG: ArenaConfig = {
  playerBlade: "dragoon",
  aiBlade: "driger",
  difficulty: "medium"
};

export const DIFFICULTY_AI_DODGE_CHANCE = {
  easy: 0.03,
  medium: 0.42,
  hard: 0.62
} as const;

export const DIFFICULTY_AI_ACTION_DELAY = {
  easy: 2100,
  medium: 720,
  hard: 520
} as const;

export const DIFFICULTY_AI_DAMAGE_MULTIPLIER = {
  easy: 0.45,
  medium: 1,
  hard: 1.1
} as const;
