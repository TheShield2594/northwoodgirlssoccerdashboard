import Link from "next/link";
import ColumnKey from "@/components/ColumnKey";
import Controls from "@/components/Controls";
import DemoBanner from "@/components/DemoBanner";
import EmptySeason from "@/components/EmptySeason";
import { getSeasonBundle, listSeasons } from "@/lib/data";
import { isGoalkeeper, resolveSelection } from "@/lib/derive";
import { levelLabel, withParams } from "@/lib/format";
import type { RosterPlayer } from "@/lib/types";

export const dynamic = "force-dynamic";

/** `optional` columns drop out below 620px so G/A/PTS stay on screen. */
type Col = { key: string; label: string; optional?: boolean };

const FIELD_COLS: Col[] = [
  { key: "games_played", label: "GP" },
  { key: "goals", label: "G" },
  { key: "assists", label: "A" },
  { key: "points", label: "PTS" },
  { key: "shots", label: "SH", optional: true },
  { key: "shots_on_goal", label: "SOG", optional: true },
];
const GK_COLS: Col[] = [
  { key: "games_played", label: "GP" },
  { key: "saves", label: "SV" },
  { key: "goals_against", label: "GA" },
  { key: "shutouts", label: "SO" },
];

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: { level?: string; season?: string };
}) {
  const { seasons, demo } = await listSeasons();
  const { level, season } = resolveSelection(seasons, searchParams);
  const { bundle } = await getSeasonBundle(level, season);
  if (!bundle) {
    return (
      <EmptySeason demo={demo} seasons={seasons} level={level} season={season} title="Squad &amp; Stats" />
    );
  }

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
          <th className="col-grow">Player</th>
          <th className="col-optional">Gr</th>
          <th className="col-optional">Pos</th>
          {cols.map((c) => (
            <th key={c.key} className={`num ${c.optional ? "col-optional" : ""}`}>{c.label}</th>
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
          <p className="sub">Season totals from MaxPreps.</p>
        </div>
        <Controls seasons={seasons} level={level} season={season} />
      </div>

      {bundle.roster.length === 0 ? (
        // A season can have games but no players: MaxPreps rosters are entered
        // by the coach and are often empty early in a season (or absent for
        // older seasons). Say which it is, rather than rendering a blank table
        // that reads like the dashboard is broken.
        <section className="card ruled">
          <div className="card-head"><h2>No roster</h2></div>
          <div className="card-body">
            <p className="sub">
              No players were imported for {bundle.season.label} {levelLabel(level)}
              {bundle.games.length > 0 ? " — though its schedule was." : "."}{" "}
              Rosters are entered by the coaching staff, so a season that has just
              started often has none on MaxPreps yet. If you expect players here,
              the scraper log for this season says which it is: it reports the
              athlete count MaxPreps itself gives, and flags a mismatch as an
              error.
            </p>
          </div>
        </section>
      ) : (
      <div className="stack">
        <section className="card ruled">
          <div className="card-head">
            <h2>Outfield</h2>
            <span className="note">sorted by points (2×G + A)</span>
          </div>
          <div className="card-body">
            <div className="table-scroll">{renderTable(field, FIELD_COLS)}</div>
            <ColumnKey keys={FIELD_COLS.map((c) => c.key)} />
          </div>
        </section>

        {keepers.length > 0 && (
          <section className="card">
            <div className="card-head"><h2>Goalkeepers</h2></div>
            <div className="card-body">
              <div className="table-scroll">{renderTable(keepers, GK_COLS)}</div>
              <ColumnKey keys={GK_COLS.map((c) => c.key)} />
            </div>
          </section>
        )}
      </div>
      )}
    </>
  );
}
