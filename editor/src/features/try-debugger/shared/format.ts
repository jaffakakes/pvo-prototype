export function formatVideoTime(seconds: number, tenths = false): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const base = `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  return tenths ? `${base}.${Math.floor((safe % 1) * 10)}` : base;
}

export function formatElapsed(milliseconds: number): string {
  const safe = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  return safe < 1000 ? `${Math.round(safe)} ms` : `${(safe / 1000).toFixed(1)} s`;
}
