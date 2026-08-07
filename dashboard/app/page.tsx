import Link from "next/link";
import Controls from "@/components/Controls";
import DemoBanner from "@/components/DemoBanner";
import LeaderBoard from "@/components/LeaderBoard";
import DualTrendChart from "@/components/charts/DualTrendChart";
import MarginBars from "@/components/charts/MarginBars";
import { getSeasonBundle, listSeasons } from "@/lib/data";
import { deriveSeason, resolveSelection } from "@/lib/derive";
import { confRecord, fmtDate, fmtDateLong, levelLabel, record, withParams } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { level?: string; season?: string };
}) {
  const { seasons, demo } = await listSeasons();
  const { level, season } = resolveSelection(seasons, searchParams);
  const { bundle } = await getSeasonBundle(level, season);

  if (!bundle) {
    return (
      <>
        <DemoBanner demo={demo} />
        <p>No data for this season yet.</p>
      </>
    );
  }

  const s = bundle.season;
  const d = deriveSeason(bundle);
  const lastGame = d.played[d.played.length - 1];
  const nextGame = d.upcoming[0];

  const trendPoints = d.played.map((g) => ({
    label: fmtDate(g.date),
    title: `${g.homeAway === "away" ? "@" : "vs"} ${g.opponent} · ${fmtDate(g.date)}`,
    a: g.teamScore ?? 0,
    b: g.opponentScore ?? 0,
  }));

  const marginPoints = d.played.map((g) => ({
    label: fmtDate(g.date),
    title: `${g.homeAway === "away" ? "@" : "vs"} ${g.opponent} · ${fmtDate(g.date)}`,
    margin: (g.teamScore ?? 0) - (g.opponentScore ?? 0),
    result: g.result as "W" | "L" | "T",
    score: `${g.teamScore}-${g.opponentScore}`,
  }));

  return (
    <>
      <DemoBanner demo={demo} />

      <div className="page-head">
        <div>
          <span className="kicker">
            {s.label} · {levelLabel(level)}
          </span>
          <h1>Season Overview</h1>
        </div>
        <Controls seasons={seasons} level={level} season={season} />
      </div>

      <div className="grid-31">
        {/* ------------------------------- main column: how the season went */}
        <div className="stack">
          {/* record card */}
          <section className="card ruled">
            <div className="card-body record-card">
              <div className="record-figure">
                <div className="t-label">Overall record</div>
                <div className="record-value">{record(s)}</div>
              </div>
              <div className="record-facts">
                <div>
                  <span className="badge red">NLC</span>
                  <strong>{confRecord(s)}</strong>
                  <span className="fact-tail">in conference</span>
                </div>
                <div>
                  <span className="badge">GD</span>
                  <strong>{d.goalDiff > 0 ? `+${d.goalDiff}` : d.goalDiff}</strong>
                  <span className="fact-tail">goal differential</span>
                </div>
                <div>
                  <span className="badge">H/A</span>
                  <strong>{d.homeRecord}</strong>
                  <span className="fact-tail">home ·</span>
                  <strong>{d.awayRecord}</strong>
                  <span className="fact-tail">away</span>
                </div>
              </div>
              <div className="record-form">
                <div className="t-label">Last 6 · streak {d.streak}</div>
                <div className="form-dots">
                  {d.form.map((g) => (
                    <span
                      key={g.id}
                      className={`form-dot ${g.result}`}
                      title={`${g.result} ${g.teamScore}-${g.opponentScore} ${g.homeAway === "away" ? "@" : "vs"} ${g.opponent}`}
                    >
                      {g.result}
                      {/* the letter alone is meaningless out of context, so the
                          accessible name carries the whole result */}
                      <span className="sr-only">
                        {` ${g.teamScore}-${g.opponentScore} ${g.homeAway === "away" ? "away at" : "home vs"} ${g.opponent}`}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Stat tiles. Exactly one tile carries emphasis — win rate, the
              headline of the four — so the row has a single entry point.
              Clean sheets used to compete for it with the inverse fill. */}
          <div className="tile-row">
            <div className="tile inverse">
              <div className="t-label">Win rate</div>
              <div className="t-value"><span className="red">{Math.round(d.winPct * 100)}</span><span className="unit">%</span></div>
              <div className="t-sub">{s.wins} wins in {d.played.length} played</div>
            </div>
            <div className="tile">
              <div className="t-label">Goals / game</div>
              <div className="t-value">{d.goalsPerGame.toFixed(1)}</div>
              <div className="t-sub">{s.goalsFor} scored</div>
            </div>
            <div className="tile">
              <div className="t-label">Against / game</div>
              <div className="t-value">{d.goalsAgainstPerGame.toFixed(1)}</div>
              <div className="t-sub">{s.goalsAgainst} conceded</div>
            </div>
            <div className="tile">
              <div className="t-label">Clean sheets</div>
              <div className="t-value">{d.shutouts}</div>
              <div className="t-sub">{Math.round(d.cleanSheetPct * 100)}% of matches</div>
            </div>
          </div>

          {/* next / last match */}
          <section className="card ruled">
            <div className="card-head">
              <h2>{nextGame ? "Next match" : "Final match"}</h2>
              <Link href={withParams("/schedule", level, season)} className="note head-link">
                Full schedule →
              </Link>
            </div>
            <div className="card-body">
              {nextGame ? (
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", fontWeight: 620 }}>
                    {nextGame.homeAway === "away" ? "@ " : "vs "}
                    {nextGame.opponent}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 4 }}>
                    {fmtDateLong(nextGame.date)}
                    {nextGame.time ? ` · ${nextGame.time}` : ""}
                    {nextGame.isConference ? " · conference" : ""}
                    {nextGame.isPlayoff ? " · playoff" : ""}
                  </div>
                </div>
              ) : lastGame ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className={`chip ${lastGame.result}`}>{lastGame.result}</span>
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {lastGame.homeAway === "away" ? "@ " : "vs "}
                      {lastGame.opponent}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{fmtDateLong(lastGame.date)}</div>
                  </div>
                  <div style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "1.4rem", fontWeight: 600 }}>
                    {lastGame.teamScore}–{lastGame.opponentScore}
                  </div>
                </div>
              ) : (
                <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Schedule not posted yet.</p>
              )}

              {/* Short upcoming list, ruled off from the featured fixture above
                  it. Kickoff time takes the right-hand column — where a played
                  match shows its score — instead of the dashed placeholder chip
                  that used to sit there reading like a rendering failure. */}
              <div className="match-list">
              {d.upcoming.slice(nextGame ? 1 : 0, 4).map((g) => (
                <div className="match-row" key={g.id}>
                  <div className="m-date">{fmtDateLong(g.date)}</div>
                  <div>
                    <div className="m-opp">{g.homeAway === "away" ? "@ " : "vs "}{g.opponent}</div>
                    <div className="m-meta">
                      {g.isPlayoff ? "Playoff" : g.isConference ? "Conference" : g.isTournament ? "Tournament" : "Non-conference"}
                    </div>
                  </div>
                  <span className="m-time">{g.time ?? "TBD"}</span>
                </div>
              ))}
              </div>
            </div>
          </section>

          {/* scoring trend */}
          <section className="card">
            <div className="card-head">
              <h2>Scoring trend</h2>
              <span className="note">goals for vs. against, by match</span>
            </div>
            <div className="card-body">
              <DualTrendChart
                points={trendPoints}
                aLabel="For"
                bLabel="Against"
                ariaLabel={`Goals for and against by match, ${s.label} ${levelLabel(level)}`}
              />
            </div>
          </section>

          {/* margins */}
          <section className="card">
            <div className="card-head">
              <h2>Match margins</h2>
              <span className="note">goal differential per game</span>
            </div>
            <div className="card-body">
              <MarginBars
                points={marginPoints}
                ariaLabel={`Goal margin by game, ${s.label} ${levelLabel(level)}`}
              />
            </div>
          </section>
        </div>

        {/* ------------------------------------------ rail: who did the scoring */}
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Golden boot</h2>
              <Link href={withParams("/players", level, season)} className="note head-link">
                All players →
              </Link>
            </div>
            <div className="card-body">
              <LeaderBoard players={bundle.roster} statKey="goals" unit="goals" level={level} season={season} />
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Playmakers</h2></div>
            <div className="card-body">
              <LeaderBoard players={bundle.roster} statKey="assists" unit="assists" level={level} season={season} />
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Between the posts</h2></div>
            <div className="card-body">
              <LeaderBoard players={bundle.roster} statKey="saves" unit="saves" level={level} season={season} limit={2} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
