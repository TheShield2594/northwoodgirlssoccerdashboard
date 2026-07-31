import type { Game, Level, SeasonBundle, SeasonInfo, StatKey } from "./types";

/**
 * Single goalkeeper test used by every page: the listed position wins, and
 * recorded saves only count as a fallback when no position is known — so a
 * keeper who scores a goal is still a keeper.
 */
export function isGoalkeeper(
  position: string | null | undefined,
  stats: Partial<Record<StatKey, number>> | undefined
): boolean {
  const pos = (position ?? "").toLowerCase();
  if (pos) return pos.includes("gk") || pos.includes("keep") || pos.includes("goalie");
  return (stats?.saves ?? 0) > 0;
}

export interface SeasonDerived {
  played: Game[];
  upcoming: Game[];
  winPct: number;
  goalsPerGame: number;
  goalsAgainstPerGame: number;
  shutouts: number;
  cleanSheetPct: number;
  form: Game[]; // last 6 played
  streak: string; // "W3", "L1", "T1" or "—"
  goalDiff: number;
  homeRecord: string;
  awayRecord: string;
}

export function deriveSeason(bundle: SeasonBundle): SeasonDerived {
  const played = bundle.games
    .filter((g) => g.result !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcoming = bundle.games
    .filter((g) => g.result === null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const n = played.length;
  const wins = played.filter((g) => g.result === "W").length;
  const ties = played.filter((g) => g.result === "T").length;
  const gf = played.reduce((s, g) => s + (g.teamScore ?? 0), 0);
  const ga = played.reduce((s, g) => s + (g.opponentScore ?? 0), 0);
  const shutouts = played.filter((g) => (g.opponentScore ?? 0) === 0).length;

  let streak = "—";
  if (n > 0) {
    const last = played[n - 1].result!;
    let count = 0;
    for (let i = n - 1; i >= 0 && played[i].result === last; i--) count++;
    streak = `${last}${count}`;
  }

  const rec = (games: Game[]) => {
    const w = games.filter((g) => g.result === "W").length;
    const l = games.filter((g) => g.result === "L").length;
    const t = games.filter((g) => g.result === "T").length;
    return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
  };

  return {
    played,
    upcoming,
    winPct: n === 0 ? 0 : (wins + ties * 0.5) / n,
    goalsPerGame: n === 0 ? 0 : gf / n,
    goalsAgainstPerGame: n === 0 ? 0 : ga / n,
    shutouts,
    cleanSheetPct: n === 0 ? 0 : shutouts / n,
    form: played.slice(-6),
    streak,
    goalDiff: gf - ga,
    homeRecord: rec(played.filter((g) => g.homeAway === "home")),
    awayRecord: rec(played.filter((g) => g.homeAway !== "home")),
  };
}

/** Pick the level/season selection from URL params, with sane defaults. */
export function resolveSelection(
  seasons: SeasonInfo[],
  searchParams: { level?: string; season?: string }
): { level: Level; season: string } {
  const level: Level = searchParams.level === "jv" ? "jv" : "varsity";
  const forLevel = seasons.filter((s) => s.level === level);
  const requested = searchParams.season;
  const season =
    requested && forLevel.some((s) => s.slug === requested)
      ? requested
      : forLevel[0]?.slug ?? seasons[0]?.slug ?? "25-26";
  return { level, season };
}
