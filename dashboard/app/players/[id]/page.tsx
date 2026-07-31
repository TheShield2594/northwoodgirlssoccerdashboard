import Link from "next/link";
import DemoBanner from "@/components/DemoBanner";
import Sparkline from "@/components/charts/Sparkline";
import { getPlayerDetail, listSeasons } from "@/lib/data";
import { isGoalkeeper, resolveSelection } from "@/lib/derive";
import { fmtDateYear, levelLabel, withParams } from "@/lib/format";
import { STAT_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { level?: string; season?: string };
}) {
  const { seasons, demo } = await listSeasons();
  const { level, season } = resolveSelection(seasons, searchParams);

  // Only well-formed numeric ids ever reach the data layer.
  const playerId = /^\d+$/.test(params.id) ? Number(params.id) : null;
  const { player } = playerId !== null
    ? await getPlayerDetail(playerId)
    : { player: null };

  if (!player) {
    return (
      <>
        <DemoBanner demo={demo} />
        <p>Player not found.</p>
      </>
    );
  }

  const current =
    player.seasons.find((s) => s.seasonSlug === season && s.level === level) ??
    player.seasons[player.seasons.length - 1];

  // Career totals: every season summed, both levels included.
  const careerStats: Record<string, number> = {};
  for (const s of player.seasons) {
    for (const [k, v] of Object.entries(s.stats)) {
      careerStats[k] = (careerStats[k] ?? 0) + (v ?? 0);
    }
  }
  const isKeeper = isGoalkeeper(current?.position, careerStats);

  const heroKeys = isKeeper
    ? ["games_played", "saves", "goals_against", "shutouts"]
    : ["games_played", "goals", "assists", "points"];

  const goalsBySeason = player.seasons
    .filter((s) => s.level === (current?.level ?? "varsity"))
    .map((s) => (isKeeper ? s.stats.saves ?? 0 : s.stats.goals ?? 0));

  // Columns for the game log: union of stat keys that appear
  const logKeys = Array.from(
    new Set(player.gameLog.flatMap((g) => Object.keys(g.stats)))
  ).filter((k) => ["goals", "assists", "shots", "shots_on_goal", "saves", "goals_against", "shutouts"].includes(k));

  return (
    <>
      <DemoBanner demo={demo} />

      <div className="page-head">
        <div>
          <span className="kicker">
            {current ? `${current.seasonLabel} · ${levelLabel(current.level)}` : "Career"}
            {current?.position ? ` · ${current.position}` : ""}
            {current?.grade ? ` · ${current.grade}` : ""}
          </span>
          <h1 style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {current?.jersey && (
              <span className="jersey" style={{ width: 40, height: 40, fontSize: "1rem", borderRadius: 9 }}>
                {current.jersey}
              </span>
            )}
            {player.name}
          </h1>
        </div>
        <Link href={withParams("/players", level, season)} className="badge outline" style={{ padding: "8px 14px" }}>
          ← All players
        </Link>
      </div>

      <div className="stack">
        {/* career tiles */}
        <div className="tile-row">
          {heroKeys.map((k, i) => (
            <div key={k} className={`tile ${i === 1 ? "accent" : ""}`}>
              <div className="t-label">Career {STAT_LABELS[k] ?? k.replace(/_/g, " ")}</div>
              <div className="t-value">{careerStats[k] ?? 0}</div>
              <div className="t-sub">{player.seasons.length} season{player.seasons.length === 1 ? "" : "s"} on record</div>
            </div>
          ))}
          {goalsBySeason.length > 1 && (
            <div className="tile">
              <div className="t-label">{isKeeper ? "Saves" : "Goals"} by season</div>
              <div style={{ marginTop: 10 }}>
                <Sparkline values={goalsBySeason} width={130} height={34} />
              </div>
            </div>
          )}
        </div>

        {/* season by season */}
        <section className="card ruled">
          <div className="card-head"><h2>Season by season</h2></div>
          <div className="card-body table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Level</th>
                  <th>Gr</th>
                  <th>Pos</th>
                  {(isKeeper ? ["games_played", "saves", "goals_against", "shutouts"] : ["games_played", "goals", "assists", "points", "shots", "shots_on_goal"]).map((k) => (
                    <th key={k} className="num">{STAT_LABELS[k] ?? k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {player.seasons.map((s) => (
                  <tr key={`${s.level}:${s.seasonSlug}`}>
                    <td className="strong">{s.seasonLabel}</td>
                    <td>
                      <span className={`badge ${s.level === "varsity" ? "red" : ""}`}>{levelLabel(s.level)}</span>
                    </td>
                    <td style={{ color: "var(--muted)" }}>{s.grade ?? "—"}</td>
                    <td style={{ color: "var(--muted)" }}>{s.position ?? "—"}</td>
                    {(isKeeper ? ["games_played", "saves", "goals_against", "shutouts"] : ["games_played", "goals", "assists", "points", "shots", "shots_on_goal"]).map((k) => (
                      <td key={k} className="num">{s.stats[k] ?? "·"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* game log */}
        {player.gameLog.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h2>Game log</h2>
              <span className="note">games with recorded stats</span>
            </div>
            <div className="card-body table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Opponent</th>
                    <th>Result</th>
                    {logKeys.map((k) => (
                      <th key={k} className="num">{STAT_LABELS[k] ?? k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {player.gameLog.slice(-30).map((g, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{fmtDateYear(g.date)}</td>
                      <td className="strong">{g.opponent}</td>
                      <td>
                        {g.result && <span className={`chip ${g.result}`}>{g.result}</span>}{" "}
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--muted)" }}>
                          {g.teamScore !== null ? `${g.teamScore}–${g.opponentScore}` : ""}
                        </span>
                      </td>
                      {logKeys.map((k) => (
                        <td key={k} className="num">{g.stats[k] ?? "·"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
