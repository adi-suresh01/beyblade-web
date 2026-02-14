import {
  DIFFICULTY_AI_ACTION_DELAY,
  DIFFICULTY_AI_DODGE_CHANCE,
  MAX_BIT
} from "@/lib/game/constants";
import { Difficulty, GameCommand } from "@/lib/game/types";

interface DecideActionInput {
  difficulty: Difficulty;
  aiBit: number;
  aiHp: number;
  playerHp: number;
}

export function aiMayReactivelyDodge(difficulty: Difficulty): boolean {
  return Math.random() < DIFFICULTY_AI_DODGE_CHANCE[difficulty];
}

export function aiActionDelay(difficulty: Difficulty): number {
  return DIFFICULTY_AI_ACTION_DELAY[difficulty];
}

export function decideAiAction(input: DecideActionInput): GameCommand {
  if (input.aiBit >= MAX_BIT) {
    return "bit-beast";
  }

  const hpGap = input.playerHp - input.aiHp;
  const defenseBias = hpGap < -20 ? 0.45 : 0.28;
  const hardAttackBias = input.difficulty === "hard" ? 0.72 : 0.6;

  const roll = Math.random();
  if (roll < defenseBias) {
    return "dodge";
  }

  if (roll < hardAttackBias) {
    return "attack";
  }

  return input.aiBit > 70 ? "attack" : "dodge";
}
