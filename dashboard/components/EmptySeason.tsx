import Controls from "@/components/Controls";
import DemoBanner from "@/components/DemoBanner";
import { levelLabel } from "@/lib/format";
import type { Level, SeasonInfo } from "@/lib/types";

/**
 * The "this season holds nothing" state, for pages that would otherwise have
 * rendered a table.
 *
 * These used to be a bare `<p>No data for this season.</p>` — no heading, no
 * card, and crucially no `Controls`, so a visitor who landed on an empty
 * season had nothing on the page to get out of it except the browser's back
 * button. The season picker is the one thing that must always survive.
 */
export default function EmptySeason({
  demo,
  seasons,
  level,
  season,
  title,
  detail,
}: {
  demo: boolean;
  seasons: SeasonInfo[];
  level: Level;
  season: string;
  title: string;
  detail?: string;
}) {
  const label = seasons.find((s) => s.slug === season && s.level === level)?.label ?? season;

  return (
    <>
      <DemoBanner demo={demo} />
      <div className="page-head">
        <div>
          <span className="kicker">
            {label} · {levelLabel(level)}
          </span>
          <h1>{title}</h1>
        </div>
        <Controls seasons={seasons} level={level} season={season} />
      </div>

      <section className="card ruled">
        <div className="card-head"><h2>Nothing recorded</h2></div>
        <div className="card-body">
          <p className="sub" style={{ marginTop: 0 }}>
            {detail ??
              `There's no ${levelLabel(level)} data for ${label} in the database yet.`}{" "}
            Pick another season or squad above — the rest of the program is still there.
          </p>
        </div>
      </section>
    </>
  );
}
