export type VoiceChannel = "player" | "ai" | "unknown";

export interface VoiceSuppression {
  suppressed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export interface VoiceHistoryItem {
  text: string;
  at: number;
  channel: VoiceChannel;
}

export interface VoiceSessionState {
  key: string;
  createdAt: number;
  updatedAt: number;
  lastSpokenAt: number;
  lastHeardAt: number;
  recentSpoken: VoiceHistoryItem[];
  recentHeard: VoiceHistoryItem[];
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

export function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeVoiceText(left));
  const rightTokens = new Set(tokenizeVoiceText(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  return unionSize ? intersection / unionSize : 0;
}

export function resolveVoiceSessionKey(sessionId: string | undefined, headers: Headers): string {
  const explicit = normalizeVoiceText(sessionId || "").slice(0, 80);
  if (explicit) {
    return `session:${explicit}`;
  }

  const forwardedFor = headers.get("x-forwarded-for") || "unknown-ip";
  const ip = forwardedFor.split(",")[0]?.trim() || "unknown-ip";
  const userAgent = headers.get("user-agent") || "unknown-agent";
  const compactAgent = normalizeVoiceText(userAgent).slice(0, 60);
  return `ua:${ip}:${compactAgent || "unknown-agent"}`;
}
