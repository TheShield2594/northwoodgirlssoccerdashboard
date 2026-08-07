"use client";

/**
 * Level toggle + season picker. Selection lives in the URL (?level=&season=)
 * so it survives navigation and is shareable/bookmarkable.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LEVEL_ORDER } from "@/lib/derive";
import { levelLabel } from "@/lib/format";
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

  // Driven by what the scraper found, not a hardcoded pair, so a newly
  // added squad shows up on its own. Display order — and the order the
  // default selection falls through — is LEVEL_ORDER, shared with
  // resolveSelection so the filled segment always matches what loaded.
  const levels = LEVEL_ORDER.filter((l) => seasons.some((s) => s.level === l));
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
            {levelLabel(l)}
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
