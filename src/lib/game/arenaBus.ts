import { DEFAULT_ARENA_CONFIG } from "@/lib/game/constants";
import {
  ArenaConfig,
  ArenaLog,
  ArenaState,
  GameCommand,
  TauntRequest
} from "@/lib/game/types";

const EVENT_STATE = "arena:state";
const EVENT_LOG = "arena:log";
const EVENT_TAUNT = "arena:taunt-request";
const EVENT_COMMAND = "arena:command";
const EVENT_CONFIG = "arena:config";
const EVENT_RESET = "arena:reset";

const bus = new EventTarget();
let latestConfig: ArenaConfig = DEFAULT_ARENA_CONFIG;

export function getArenaConfig(): ArenaConfig {
  return latestConfig;
}

export function emitArenaState(state: ArenaState): void {
  bus.dispatchEvent(new CustomEvent(EVENT_STATE, { detail: state }));
}

export function emitArenaLog(log: ArenaLog): void {
  bus.dispatchEvent(new CustomEvent(EVENT_LOG, { detail: log }));
}

export function emitTauntRequest(request: TauntRequest): void {
  bus.dispatchEvent(new CustomEvent(EVENT_TAUNT, { detail: request }));
}

export function sendArenaCommand(command: GameCommand): void {
  bus.dispatchEvent(new CustomEvent(EVENT_COMMAND, { detail: command }));
}

export function sendArenaConfig(config: ArenaConfig): void {
  latestConfig = config;
  bus.dispatchEvent(new CustomEvent(EVENT_CONFIG, { detail: config }));
}

export function sendArenaReset(): void {
  bus.dispatchEvent(new CustomEvent(EVENT_RESET));
}

function subscribe<T>(
  eventName: string,
  handler: (detail: T) => void
): () => void {
  const wrapped = (event: Event) => {
    handler((event as CustomEvent<T>).detail);
  };

  bus.addEventListener(eventName, wrapped);
  return () => bus.removeEventListener(eventName, wrapped);
}

export function subscribeArenaState(handler: (state: ArenaState) => void): () => void {
  return subscribe<ArenaState>(EVENT_STATE, handler);
}

export function subscribeArenaLog(handler: (log: ArenaLog) => void): () => void {
  return subscribe<ArenaLog>(EVENT_LOG, handler);
}

export function subscribeTauntRequest(
  handler: (request: TauntRequest) => void
): () => void {
  return subscribe<TauntRequest>(EVENT_TAUNT, handler);
}

export function subscribeArenaCommand(
  handler: (command: GameCommand) => void
): () => void {
  return subscribe<GameCommand>(EVENT_COMMAND, handler);
}

export function subscribeArenaConfig(
  handler: (config: ArenaConfig) => void
): () => void {
  return subscribe<ArenaConfig>(EVENT_CONFIG, handler);
}

export function subscribeArenaReset(handler: () => void): () => void {
  const wrapped = () => handler();
  bus.addEventListener(EVENT_RESET, wrapped);
  return () => bus.removeEventListener(EVENT_RESET, wrapped);
}
