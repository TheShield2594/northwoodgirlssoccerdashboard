import Link from "next/link";
import type { Level, RosterPlayer } from "@/lib/types";
import { withParams } from "@/lib/format";

/**
 * Leader list: jersey chip, name, value, and a proportional red bar.
 * Values are directly labeled so the bar is reinforcement, not the only
 * encoding.
 *
 * The whole row is the link — the name on its own was a 19px tap target.
 * The bars only appear when there are at least two players to compare: with
 * one entry the bar is `value / value`, permanently full, and encodes
 * nothing.
 */
export default function LeaderBoard({
  players,
  statKey,
  unit,
  level,
  season,
  limit = 5,
}: {
  players: RosterPlayer[];
  statKey: string;
  unit: string;
  level: Level;
  season: string;
  limit?: number;
}) {
  const ranked = players
    .filter((p) => (p.stats[statKey] ?? 0) > 0)
    .sort((a, b) => (b.stats[statKey] ?? 0) - (a.stats[statKey] ?? 0))
    .slice(0, limit);

  if (ranked.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: "0.78rem", margin: "6px 0" }}>No {unit} recorded yet.</p>;
  }
  const top = ranked[0].stats[statKey] ?? 1;
  const showBars = ranked.length > 1;

  return (
    <div>
      {ranked.map((p) => (
        <Link
          key={p.playerId}
          className="leader-row"
          href={withParams(`/players/${p.playerId}`, level, season)}
        >
          <span className="leader-head">
            <span className="jersey">{p.jersey ?? "–"}</span>
            <span className="leader-name">{p.name}</span>
            <span className="leader-value">
              {p.stats[statKey]} {unit}
            </span>
          </span>
          {showBars && (
            <span className="leader-bar" aria-hidden="true">
              <span style={{ width: `${((p.stats[statKey] ?? 0) / top) * 100}%` }} />
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
