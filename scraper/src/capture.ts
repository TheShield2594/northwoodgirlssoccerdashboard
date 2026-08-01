/**
 * Save the raw HTML of a season's pages to disk, so a parser can be fixed
 * against what MaxPreps actually serves instead of against a guess.
 *
 *   npm run capture                       # current season, varsity
 *   npm run capture -- jv                 # current season, JV
 *   npm run capture -- varsity 24-25
 *   npm run capture -- varsity 25-26 ./captured
 *
 * Writes <out>/<level>-<season>-{schedule,roster,stats}.html (default out
 * directory: ./captured, which .gitignore does NOT cover — commit the files
 * if you want them reviewed).
 *
 * These pages are public and carry no login state, but they do contain
 * student athletes' names, so treat a capture like the roster it is.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TeamLevel, currentSeasonSlug, rosterUrl, scheduleUrl, statsUrl } from "./config.js";
import { fetchHtml } from "./http.js";
import { extractJsonSources } from "./parse/nextdata.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const level: TeamLevel =
  args[0] === "jv" ? "jv" : args[0] === "freshman" ? "freshman" : "varsity";
const season = args[1] ?? currentSeasonSlug();
const outDir = resolve(args[2] ?? "captured");

async function capture(page: string, url: string): Promise<void> {
  const html = await fetchHtml(url);
  if (!html) {
    console.log(`  ${page}: FETCH FAILED (${url})`);
    return;
  }
  const file = join(outDir, `${level}-${season}-${page}.html`);
  await writeFile(file, html, "utf8");
  const layers = extractJsonSources(html).map((s) => s.kind);
  console.log(
    `  ${page}: ${(html.length / 1024).toFixed(0)} KB -> ${file}` +
      `\n    embedded JSON layers found: ${layers.length ? layers.join(", ") : "NONE (DOM fallback only)"}`
  );
}

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log(`== capturing ${level} ${season} into ${outDir} ==`);
  await capture("schedule", scheduleUrl(level, season));
  await capture("roster", rosterUrl(level, season));
  await capture("stats", statsUrl(level, season));
  console.log("== capture done ==");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
