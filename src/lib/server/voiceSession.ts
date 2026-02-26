export type VoiceChannel = "player" | "ai" | "unknown";

export interface VoiceSuppression {
  suppressed: boolean;
  reason?: string;
  retryAfterMs?: number;
}
