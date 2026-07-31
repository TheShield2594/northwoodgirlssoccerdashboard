import Link from "next/link";
import type { Level, RosterPlayer } from "@/lib/types";
import { withParams } from "@/lib/format";

/**
 * Leader list: jersey chip, name, value, and a proportional red bar.
 * Values are directly labeled so the bar is reinforcement, not the only
 * encoding.
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

  return (
    <div>
      {ranked.map((p) => (
        <div key={p.playerId} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
            <span className="jersey">{p.jersey ?? "–"}</span>
            <Link
              href={withParams(`/players/${p.playerId}`, level, season)}
              style={{ fontWeight: 700, fontSize: "0.84rem", flex: 1 }}
            >
              {p.name}
            </Link>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.78rem",
                fontWeight: 600,
                color: "var(--ink-soft)",
              }}
            >
              {p.stats[statKey]} {unit}
            </span>
          </div>
          <div style={{ height: 5, background: "var(--gray-chip)", borderRadius: 99, marginLeft: 35, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${((p.stats[statKey] ?? 0) / top) * 100}%`,
                background: "linear-gradient(90deg, var(--red), var(--red-deep))",
                borderRadius: 99,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
