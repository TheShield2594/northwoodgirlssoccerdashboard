import Controls from "@/components/Controls";
import DemoBanner from "@/components/DemoBanner";
import { getSeasonBundle, listSeasons } from "@/lib/data";
import { deriveSeason, resolveSelection } from "@/lib/derive";
import { fmtDateLong, levelLabel, record } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { level?: string; season?: string };
}) {
  const { seasons, demo } = await listSeasons();
  const { level, season } = resolveSelection(seasons, searchParams);
  const { bundle } = await getSeasonBundle(level, season);

  if (!bundle) return <p>No data for this season.</p>;
  const d = deriveSeason(bundle);
  const all = [...d.played, ...d.upcoming];

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
            postseason marked <span className="badge">Playoff</span>
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
                <th>Opponent</th>
                <th>Type</th>
                <th className="num">Score</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {all.map((g) => (
                <tr key={g.id}>
                  <td style={{ whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--ink-soft)" }}>
                    {fmtDateLong(g.date)}
                    {g.time ? <span style={{ color: "var(--muted)" }}> · {g.time}</span> : null}
                  </td>
                  <td style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {g.homeAway === "away" ? "@" : g.homeAway === "neutral" ? "N" : "vs"}
                  </td>
                  <td className="strong">{g.opponent}</td>
                  <td>
                    {g.isPlayoff ? (
                      <span className="badge">Playoff</span>
                    ) : g.isConference ? (
                      <span className="badge red">NLC</span>
                    ) : g.isTournament ? (
                      <span className="badge outline">Tourney</span>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>Non-conf</span>
                    )}
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
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
