export function nowIso(): string {
  return new Date().toISOString();
}

export function addSecondsIso(seconds: number, now = new Date()): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function isPastIso(value: string, now = new Date()): boolean {
  return Date.parse(value) <= now.getTime();
}
