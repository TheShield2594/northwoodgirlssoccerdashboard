import type { Level, SeasonInfo } from "./types";

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

export function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function fmtDateYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function record(s: SeasonInfo): string {
  return s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
}

export function confRecord(s: SeasonInfo): string {
  return s.confTies > 0
    ? `${s.confWins}-${s.confLosses}-${s.confTies}`
    : `${s.confWins}-${s.confLosses}`;
}

export function winPct(s: SeasonInfo): number {
  const played = s.wins + s.losses + s.ties;
  if (played === 0) return 0;
  return (s.wins + s.ties * 0.5) / played;
}

export function levelLabel(level: Level): string {
  return level === "jv" ? "JV" : "Varsity";
}

/** Build an href that keeps the level/season selection in the URL. */
export function withParams(path: string, level: Level, season: string): string {
  return `${path}?level=${level}&season=${season}`;
}
