export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function logId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
