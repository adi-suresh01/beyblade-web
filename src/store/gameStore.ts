import { create } from "zustand";
import { ArenaLog, ArenaState } from "@/lib/game/types";

interface GameStore {
  arena: ArenaState;
  logs: ArenaLog[];
  setArena: (arena: ArenaState) => void;
  pushLog: (log: ArenaLog) => void;
  clearLogs: () => void;
}

const INITIAL_ARENA: ArenaState = {
  playerHp: 100,
  aiHp: 100,
  playerBit: 0,
  aiBit: 0,
  roundTimeMs: 0,
  winner: null
};

export const useGameStore = create<GameStore>((set) => ({
  arena: INITIAL_ARENA,
  logs: [],
  setArena: (arena) => set({ arena }),
  pushLog: (log) =>
    set((state) => {
      const next = [log, ...state.logs];
      return { logs: next.slice(0, 40) };
    }),
  clearLogs: () => set({ logs: [] })
}));
