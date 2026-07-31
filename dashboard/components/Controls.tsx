"use client";

/**
 * Level toggle + season picker. Selection lives in the URL (?level=&season=)
 * so it survives navigation and is shareable/bookmarkable.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Level, SeasonInfo } from "@/lib/types";

export default function Controls({
  seasons,
  level,
  season,
}: {
  seasons: SeasonInfo[];
  level: Level;
  season: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const levels: Level[] = ["varsity", "jv"];
  const seasonsForLevel = seasons.filter((s) => s.level === level);

  function push(nextLevel: Level, nextSeason: string) {
    const p = new URLSearchParams(params.toString());
    p.set("level", nextLevel);
    p.set("season", nextSeason);
    router.push(`${pathname}?${p.toString()}`);
  }

  function switchLevel(l: Level) {
    if (l === level) return;
    // keep the same season if the other level has it, else its newest
    const target = seasons.some((s) => s.level === l && s.slug === season)
      ? season
      : seasons.find((s) => s.level === l)?.slug ?? season;
    push(l, target);
  }

  return (
    <div className="controls">
      <div className="seg" role="group" aria-label="Team level">
        {levels.map((l) => (
          <button
            key={l}
            type="button"
            data-active={l === level}
            aria-pressed={l === level}
            onClick={() => switchLevel(l)}
          >
            {l === "jv" ? "JV" : "Varsity"}
          </button>
        ))}
      </div>
      <select
        className="select-pill"
        aria-label="Season"
        value={season}
        onChange={(e) => push(level, e.target.value)}
      >
        {seasonsForLevel.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.label} · {s.slug}
          </option>
        ))}
      </select>
    </div>
  );
}
