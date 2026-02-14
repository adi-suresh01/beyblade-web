export const BEYBLADE_IDS = ["dragoon", "dranzer", "draciel", "driger"] as const;
export type BeybladeId = (typeof BEYBLADE_IDS)[number];

export type GameCommand = "attack" | "dodge" | "bit-beast";
export type Difficulty = "easy" | "medium" | "hard";

export interface BeybladeProfile {
  id: BeybladeId;
  name: string;
  color: string;
  bitBeast: string;
  flavor: string;
}

export interface ArenaConfig {
  playerBlade: BeybladeId;
  aiBlade: BeybladeId;
  difficulty: Difficulty;
}

export interface ArenaState {
  playerHp: number;
  aiHp: number;
  playerBit: number;
  aiBit: number;
  roundTimeMs: number;
  winner: "player" | "ai" | null;
}

export interface ArenaLog {
  id: string;
  speaker: "player" | "ai" | "system";
  text: string;
  kind: "combat" | "trash";
  timestamp: number;
}

export interface TauntRequest {
  trigger: "ai-hit" | "ai-dodge" | "ai-bit-beast" | "player-miss";
  playerText?: string;
}
