export type VoiceChannel = "player" | "ai" | "unknown";

export interface VoiceSuppression {
  suppressed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export function normalizeVoiceText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeVoiceText(input: string): string[] {
  return normalizeVoiceText(input).split(" ").filter(Boolean);
}
