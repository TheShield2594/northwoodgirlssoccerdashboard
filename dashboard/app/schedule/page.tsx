import Controls from "@/components/Controls";
import DemoBanner from "@/components/DemoBanner";
import EmptySeason from "@/components/EmptySeason";
import { getSeasonBundle, listSeasons } from "@/lib/data";
import { deriveSeason, resolveSelection } from "@/lib/derive";
import { fmtDateCompact, fmtDateLong, levelLabel, record } from "@/lib/format";
import type { Game } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The badge a game wears, or null for a plain non-conference fixture. */
function gameTag(g: Game): { label: string; cls: string } | null {
  if (g.isPlayoff) return { label: "Playoff", cls: "badge" };
  if (g.isConference) return { label: "NLC", cls: "badge red" };
  if (g.isTournament) return { label: "Tourney", cls: "badge outline" };
  return null;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { level?: string; season?: string };
}) {
  const { seasons, demo } = await listSeasons();
  const { level, season } = resolveSelection(seasons, searchParams);
  const { bundle } = await getSeasonBundle(level, season);

  if (!bundle) {
    return (
      <EmptySeason
        demo={demo}
        seasons={seasons}
        level={level}
        season={season}
        title="Schedule &amp; Results"
      />
    );
  }
  const d = deriveSeason(bundle);

  const row = (g: Game) => {
    const tag = gameTag(g);
    return (
      <tr key={g.id}>
        <td className="cell-date" style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--ink-soft)" }}>
          <span className="date-long">{fmtDateLong(g.date)}</span>
          <span className="date-short">{fmtDateCompact(g.date)}</span>
          {g.time ? <span className="match-time">{g.time}</span> : null}
        </td>
        <td style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
          {g.homeAway === "away" ? "@" : g.homeAway === "neutral" ? "N" : "vs"}
        </td>
        {/* The badge rides with the opponent rather than occupying a column
            of its own. As a column it was `col-optional`, so it vanished below
            620px — the page's whole point, conference standing, dropped out on
            phones while the legend above still promised it. */}
        <td className="strong">
          {g.opponent}
          {tag && <span className={`${tag.cls} tag-inline`}>{tag.label}</span>}
        </td>
        <td className="num" style={{ fontWeight: 600 }}>
          {g.result ? `${g.teamScore}–${g.opponentScore}` : "—"}
        </td>
        <td>
          {g.result ? (
            <span className={`chip ${g.result}`}>{g.result}</span>
          ) : (
            <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>upcoming</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <>
      <DemoBanner demo={demo} />
      <div className="page-head">
        <div>
          <span className="kicker">
            {bundle.season.label} · {levelLabel(level)} · {record(bundle.season)}
          </span>
          <h1>Schedule &amp; Results</h1>
          <p className="sub">
            Conference matches marked <span className="badge red">NLC</span> ·
            postseason marked <span className="badge">Playoff</span> · early-season
            tournaments <span className="badge outline">Tourney</span>
          </p>
        </div>
        <Controls seasons={seasons} level={level} season={season} />
      </div>

      <section className="card ruled">
        <div className="card-body table-scroll" style={{ paddingTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th><span className="sr-only">Venue (home/away/neutral)</span></th>
                <th className="col-grow">Opponent</th>
                <th className="num">Score</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {d.played.map(row)}
              {/* Mid-season, the line between what happened and what's next is
                  the most important break on the page. It used to be implicit
                  in the Result column; now it's a rule you can't miss, and
                  `#upcoming` gives the header link something to jump to. */}
              {d.upcoming.length > 0 && d.played.length > 0 && (
                <tr className="row-divider" id="upcoming">
                  <td colSpan={5}>
                    <span>Upcoming · {d.upcoming.length} to play</span>
                  </td>
                </tr>
              )}
              {d.upcoming.map(row)}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
