import Link from "next/link";
import Controls from "@/components/Controls";
import DemoBanner from "@/components/DemoBanner";
import { getSeasonBundle, listSeasons } from "@/lib/data";
import { isGoalkeeper, resolveSelection } from "@/lib/derive";
import { levelLabel, withParams } from "@/lib/format";
import type { RosterPlayer } from "@/lib/types";

export const dynamic = "force-dynamic";

/** `optional` columns drop out below 620px so G/A/PTS stay on screen. */
type Col = { key: string; label: string; title: string; optional?: boolean };

const FIELD_COLS: Col[] = [
  { key: "games_played", label: "GP", title: "Games played" },
  { key: "goals", label: "G", title: "Goals" },
  { key: "assists", label: "A", title: "Assists" },
  { key: "points", label: "PTS", title: "Points (2G + A)" },
  { key: "shots", label: "SH", title: "Shots", optional: true },
  { key: "shots_on_goal", label: "SOG", title: "Shots on goal", optional: true },
];
const GK_COLS: Col[] = [
  { key: "games_played", label: "GP", title: "Games played" },
  { key: "saves", label: "SV", title: "Saves" },
  { key: "goals_against", label: "GA", title: "Goals against" },
  { key: "shutouts", label: "SO", title: "Shutouts" },
];

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: { level?: string; season?: string };
}) {
  const { seasons, demo } = await listSeasons();
  const { level, season } = resolveSelection(seasons, searchParams);
  const { bundle } = await getSeasonBundle(level, season);
  if (!bundle) return <p>No data for this season.</p>;

  const isKeeper = (p: RosterPlayer) => isGoalkeeper(p.position, p.stats);

  const keepers = bundle.roster.filter(isKeeper);
  const field = bundle.roster
    .filter((p) => !isKeeper(p))
    .sort((a, b) => (b.stats.points ?? 0) - (a.stats.points ?? 0) || (b.stats.goals ?? 0) - (a.stats.goals ?? 0));

  const renderTable = (players: RosterPlayer[], cols: Col[]) => (
    <table className="data-table">
      <thead>
        <tr>
          <th style={{ width: 40 }}>#</th>
          <th>Player</th>
          <th className="col-optional">Gr</th>
          <th className="col-optional">Pos</th>
          {cols.map((c) => (
            <th key={c.key} className={`num ${c.optional ? "col-optional" : ""}`} title={c.title}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <tr key={p.playerId}>
            <td><span className="jersey">{p.jersey ?? "–"}</span></td>
            <td className="strong">
              <Link href={withParams(`/players/${p.playerId}`, level, season)}>{p.name}</Link>
            </td>
            <td className="col-optional" style={{ color: "var(--muted)" }}>{p.grade ?? "—"}</td>
            <td className="col-optional" style={{ color: "var(--muted)" }}>{p.position ?? "—"}</td>
            {cols.map((c) => (
              <td
                key={c.key}
                className={`num ${c.optional ? "col-optional" : ""} ${c.key === "goals" || c.key === "saves" ? "strong" : ""}`}
              >
                {p.stats[c.key] !== undefined ? p.stats[c.key] : "·"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <DemoBanner demo={demo} />
      <div className="page-head">
        <div>
          <span className="kicker">
            {bundle.season.label} · {levelLabel(level)} · {bundle.roster.length} players
          </span>
          <h1>Squad &amp; Stats</h1>
          <p className="sub">Season totals from MaxPreps. Click a player for their game log and career.</p>
        </div>
        <Controls seasons={seasons} level={level} season={season} />
      </div>

      <div className="stack">
        <section className="card ruled">
          <div className="card-head">
            <h2>Outfield</h2>
            <span className="note">sorted by points (2×G + A)</span>
          </div>
          <div className="card-body table-scroll">{renderTable(field, FIELD_COLS)}</div>
        </section>

        {keepers.length > 0 && (
          <section className="card">
            <div className="card-head"><h2>Goalkeepers</h2></div>
            <div className="card-body table-scroll">{renderTable(keepers, GK_COLS)}</div>
          </section>
        )}
      </div>
    </>
  );
}
