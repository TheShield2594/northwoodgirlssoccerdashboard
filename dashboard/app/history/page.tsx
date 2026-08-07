import Link from "next/link";
import Controls from "@/components/Controls";
import DemoBanner from "@/components/DemoBanner";
import RecordStack from "@/components/charts/RecordStack";
import DualTrendChart from "@/components/charts/DualTrendChart";
import { listSeasons } from "@/lib/data";
import { resolveSelection } from "@/lib/derive";
import { confRecord, levelLabel, record, winPct, withParams } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: { level?: string; season?: string };
}) {
  const { seasons, demo } = await listSeasons();
  const { level, season } = resolveSelection(seasons, searchParams);

  // oldest -> newest for charts
  const levelSeasons = seasons
    .filter((s) => s.level === level && s.gamesPlayed > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));

  const columns = levelSeasons.map((s) => ({
    label: `'${s.slug.split("-")[0]}`,
    title: `${s.label} · ${record(s)}`,
    wins: s.wins,
    losses: s.losses,
    ties: s.ties,
    href: withParams("/", level, s.slug),
  }));

  const goalPoints = levelSeasons.map((s) => ({
    label: `'${s.slug.split("-")[0]}`,
    title: s.label,
    a: s.goalsFor,
    b: s.goalsAgainst,
  }));

  // Best season by win% — but only among meaningful samples, so a 1-0
  // season can't outrank a full 14-3 one. Fall back to all seasons if no
  // season reaches the floor.
  const MIN_GAMES = 5;
  const bestPool = levelSeasons.filter((s) => s.gamesPlayed >= MIN_GAMES);
  const best = [...(bestPool.length > 0 ? bestPool : levelSeasons)].sort(
    (a, b) => winPct(b) - winPct(a) || b.gamesPlayed - a.gamesPlayed
  )[0];
  const totalW = levelSeasons.reduce((s, x) => s + x.wins, 0);
  const totalL = levelSeasons.reduce((s, x) => s + x.losses, 0);
  const totalT = levelSeasons.reduce((s, x) => s + x.ties, 0);
  const totalGF = levelSeasons.reduce((s, x) => s + x.goalsFor, 0);
  const totalGA = levelSeasons.reduce((s, x) => s + x.goalsAgainst, 0);

  return (
    <>
      <DemoBanner demo={demo} />
      <div className="page-head">
        <div>
          <span className="kicker">
            {levelLabel(level)} · {levelSeasons.length} seasons on record
          </span>
          <h1>Program History</h1>
          <p className="sub">Every season MaxPreps has data for, back to {levelSeasons[0]?.label ?? "—"}.</p>
        </div>
        <Controls seasons={seasons} level={level} season={season} />
      </div>

      <div className="stack">
        <div className="tile-row">
          <div className="tile inverse">
            <div className="t-label">All-time record</div>
            {/* One record is one string. The hyphens used to be `.unit`, which
                rendered them smaller and gray — "69-32-18" read as three
                unrelated numbers, worst on a phone. */}
            <div className="t-value">
              {totalW}-{totalL}{totalT > 0 ? `-${totalT}` : ""}
            </div>
            <div className="t-sub">across {levelSeasons.length} seasons</div>
          </div>
          <div className="tile accent">
            <div className="t-label">Best season</div>
            <div className="t-value" style={{ fontSize: "1.5rem" }}>{best ? record(best) : "—"}</div>
            <div className="t-sub">{best?.label ?? ""}</div>
          </div>
          <div className="tile">
            <div className="t-label">Goals scored</div>
            <div className="t-value">{totalGF}</div>
            <div className="t-sub">{totalGA} conceded</div>
          </div>
          <div className="tile">
            <div className="t-label">Win rate</div>
            <div className="t-value">
              {totalW + totalL + totalT > 0
                ? Math.round(((totalW + 0.5 * totalT) / (totalW + totalL + totalT)) * 100)
                : 0}
              <span className="unit">%</span>
            </div>
            <div className="t-sub">all-time, ties count half</div>
          </div>
        </div>

        <section className="card ruled">
          <div className="card-head">
            <h2>Season records</h2>
            <span className="note">click a column to open that season</span>
          </div>
          <div className="card-body">
            <RecordStack columns={columns} ariaLabel={`Wins, losses and ties by season, ${levelLabel(level)}`} />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Goals for &amp; against by season</h2>
          </div>
          <div className="card-body">
            <DualTrendChart
              points={goalPoints}
              aLabel="For"
              bLabel="Against"
              ariaLabel={`Season goal totals for and against, ${levelLabel(level)}`}
            />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Season ledger</h2>
            <span className="note">season names open that year&apos;s overview</span>
          </div>
          <div className="card-body table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th className="num">Record</th>
                  <th className="num col-optional">NLC</th>
                  <th className="num">Win %</th>
                  <th className="num col-optional">GF</th>
                  <th className="num col-optional">GA</th>
                  <th className="num">Diff</th>
                </tr>
              </thead>
              <tbody>
                {[...levelSeasons].reverse().map((s) => {
                  const diff = s.goalsFor - s.goalsAgainst;
                  return (
                    <tr key={s.slug}>
                      <td className="strong col-grow">
                        <Link href={withParams("/", level, s.slug)}>{s.label}</Link>
                      </td>
                      <td className="num strong">{record(s)}</td>
                      <td className="num col-optional">{confRecord(s)}</td>
                      <td className="num">{Math.round(winPct(s) * 100)}%</td>
                      <td className="num col-optional">{s.goalsFor}</td>
                      <td className="num col-optional">{s.goalsAgainst}</td>
                      <td className="num" style={{ color: diff > 0 ? "var(--red)" : diff < 0 ? "var(--muted)" : undefined, fontWeight: 600 }}>
                        {diff > 0 ? `+${diff}` : diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
