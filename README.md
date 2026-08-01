# NorthWood Girls Soccer — Stats Dashboard

Self-hosted stack that scrapes **MaxPreps** for NorthWood (Nappanee, IN) girls
soccer — **Varsity and JV**, current season plus every season back to 2010 —
and serves a dashboard with schedule/results, player stats, team leaders,
game-by-game charts, and full program history.

Three containers, deployable as a single Portainer/TrueNAS stack:

| Service | What it does |
|---|---|
| `postgres` | Stores seasons, games, rosters, season stats, and box-score lines. Schema auto-applies on first boot. |
| `scraper` | Node/TS. Scrapes schedule + roster + season stats (and box scores) for both levels, daily at 6am. One-shot `--backfill` walks every season back to `10-11`. |
| `dashboard` | Next.js app on port **3300**: Overview, Schedule, Players, player pages, Program History, with a Varsity/JV toggle and season picker on every page. |

## Quick start (local preview, no scraping needed)

The dashboard ships with a deterministic **sample dataset** (fictional
players, clearly bannered) so you can see the whole UI before anything is
scraped:

```bash
cd dashboard
npm install
DEMO_MODE=1 npm run dev     # http://localhost:3000
```

The same fallback kicks in automatically whenever the database is empty or
unreachable, so the dashboard never renders a blank page.

## Deploying to Portainer

Two compose files ship here:

| File | Use it when |
|---|---|
| `portainer-stack.yml` | **Normal deploys.** Pulls prebuilt images from GitHub Packages — no build on the NAS, and "pull latest" is a two-click update. |
| `docker-compose.yml` | Local development / building from source. |

### Prebuilt images (GitHub Packages)

The **Publish images** workflow (`.github/workflows/publish-images.yml`)
typechecks, runs the parser tests, then builds and pushes three images to
`ghcr.io` on every push to `main` (and on demand from the Actions tab):

```text
ghcr.io/theshield2594/northwoodgirlssoccerdashboard/dashboard:latest
ghcr.io/theshield2594/northwoodgirlssoccerdashboard/scraper:latest
ghcr.io/theshield2594/northwoodgirlssoccerdashboard/postgres:latest
```

Publishing is automatic only for pushes to `main` and `v*` tags; any other
branch publishes only when you dispatch the workflow for it by hand, which
tags it `:<branch>`. Every build gets an immutable `:sha-<short>` tag, and a
`vX.Y.Z` tag publishes `:X.Y.Z` + `:X.Y`, so you can pin or roll back by
setting `IMAGE_TAG` on the stack. `latest` only moves for `main` — and only
after all three images build, so a failure in one never leaves `latest`
pointing at a mismatched stack.

The `postgres` image is stock `postgres:17-alpine` with `db/schema.sql`
baked into `/docker-entrypoint-initdb.d/` (`db/Dockerfile`), so the stack
has no bind mounts and pastes cleanly into Portainer's web editor.

New packages are private by default. Either flip each one to **Public**
(GitHub → Packages → package → Package settings → Change visibility), or add
`ghcr.io` under Portainer → **Registries** with your GitHub handle and a PAT
carrying `read:packages`.

### Deploy

1. **Stacks → Add stack → Web editor**, paste `portainer-stack.yml`
   (or use **Repository** and set the compose path to `portainer-stack.yml`).
2. Set the `POSTGRES_PASSWORD` environment variable in the stack config —
   it's required; the stack refuses to start without it. Any characters are
   fine: the services receive it via discrete `PG*` variables, so it never
   needs URI-encoding. Optional: `IMAGE_TAG` (default `latest`) and
   `DASHBOARD_PORT` (default `3300`).
3. Deploy. Postgres applies the baked-in schema on first boot.
4. Exec into the `scraper` container and run the one-time historical
   backfill:

   ```bash
   npm run backfill
   ```

   The daily 6am cron keeps the current season fresh afterward.
5. Dashboard is at `http://<host>:<DASHBOARD_PORT>`, which is
   `http://<host>:3300` unless you set `DASHBOARD_PORT` — put it behind your
   reverse proxy / Tailscale like your other services.

### Pulling the latest build

Once the workflow is green, in Portainer: **Stacks → northwood → Update the
stack**, tick **Re-pull image and redeploy**, Update. That repoints all three
services at the current `:latest`. Postgres keeps its `pgdata` volume, so
only the code changes.

## ⚠️ Verify the scraper before trusting a backfill

This project was built in a sandbox that **cannot reach maxpreps.com**, so
the parsers have never been run against the live site, and the fixtures in
`scraper/test/fixtures/` are hand-written approximations of MaxPreps markup,
not captures of it. They're covered by tests (`cd scraper && npm test`), but
a passing test only proves the parser matches the guess.

Every parser reads embedded JSON first and falls back to DOM scraping. The
JSON layers, in the order they're tried:

| Layer | What it is |
| --- | --- |
| `nextdata` | `<script id="__NEXT_DATA__">` — the Next.js **Pages Router** payload |
| `flight` | `self.__next_f.push([1,"…"])` chunks — the **App Router** payload |
| `ldjson` | `<script type="application/ld+json">` structured data |
| `json-script` | any other JSON island on the page |
| `dom` | **no JSON matched** — opponent, venue and score are inferred from row text |

Roster pages do the same with `pageProps.athleteData` — see
`parseAthleteTuples` in `scraper/src/parse/roster.ts`. Every athlete row
carries the `teamId` and `sportSeasonId` that `pageProps.countData` also
publishes, and the parser keeps only the rows matching both: on several past
seasons `athleteData` came back with far more rows than the page's own
`athleteCount` (24-25 offered 38 rows for a 23-player team), and taking them
all imported players who were never on that roster.

`countData.athleteCount` is treated as authoritative in the other direction
too. When it says 0, no fallback runs at all — the object-shaped and DOM
fallbacks can only produce false positives against a page with no roster, and
they did: each page's schema.org breadcrumb trail is a list of
`{"@type":"ListItem","name":"NorthWood","position":3}` objects, which is a
name plus a position, which is a roster entry as far as a shape predicate is
concerned. Four of those were imported on every empty varsity season, five on
every JV one (JV pages have an extra level crumb).

Stat pages are the one place tuples can't be read positionally: a stat row is
all numbers, so nothing in the values says which column is goals. The JSON
path therefore only handles a grid that ships its column labels alongside its
rows, and reads the labels. **No stats page has been captured yet and every
season currently parses to 0 lines** — see the stats note under `verify`.

Schedule pages ship `pageProps.contests` as positional **arrays**, not objects
— there is no `date` key and no `opponent` key in them. Each team row states
its own score, venue and contest type, so the JSON layer needs none of the
inference the DOM layer does: no winner-first score ordering to undo, no
asterisks to count, no `@`/`vs` to detect. `parseContestTuples` in
`scraper/src/parse/schedule.ts` reads that shape.

That last row is the one to watch. The DOM layer doesn't fail when markup
drifts, it guesses, and wrong-but-plausible rows land in the database. The
scraper now prints a `WARNING: … came from the DOM fallback` line every time
it happens, plus warnings for a roster that parsed to zero players and a
schedule with no kickoff times. **A clean run should show no warnings.**

Before the first real run, verify from a machine that can reach the site:

```bash
cd scraper
npm install
npm run verify                  # current season, varsity
npm run verify -- jv            # current season, JV
npm run verify -- varsity 24-25 # any historical season
```

`verify` fetches one season's schedule/roster/stats/box-score pages, prints
which JSON layers each page even has, what each parser found and via which
layer, how many games came back with a kickoff time, and — if a parser comes
up empty — the page's `__NEXT_DATA__` key structure, so re-aiming the shape
predicates in `scraper/src/parse/*.ts` is quick. It never writes to the
database.

Things `verify` may surface:

- **Unmapped stat columns** (e.g. a header abbreviation not in
  `STAT_COLUMN_MAP` in `src/parse/stats.ts`) — add the mapping and re-run.
  Unknown columns are skipped, never guessed.
- **0 stat lines** — currently the case on every season. Unlike the roster,
  a stats page ships no count of its own, so "the coach entered no stats" and
  "the parser is aimed wrong" look identical. `verify` and `inspect` now print
  the page's positional-tuple shapes (`describeTupleArrays`) when nothing
  matches; that dump is what a parser gets aimed at, and it distinguishes an
  empty page from a missed one.
- **0 games parsed** — the shape predicates need re-aiming; the printed
  `pageProps` key list shows where the contest array actually lives.
- **No box score lines** — many games simply have none entered on MaxPreps;
  try another game's URL before assuming the parser is wrong.
- **0 roster entries** — check whether the log says `page reports 0 athletes`.
  MaxPreps ships its own `athleteCount`, so an empty roster is reported as
  either "nothing to import" (the coach hasn't entered one — normal for a
  season that just started) or an `ERROR` naming the mismatch. Only the
  second is a parser bug.
- **`embedded JSON layers: NONE`** — MaxPreps changed how it ships page data.
  Capture the page (below) and re-aim the parser against it; do not trust
  anything the DOM fallback imported in the meantime.

### Inspecting a page already on disk

Every fetched page is cached in the `scrapecache` volume at `/cache`, so a
page that imported badly can be re-parsed exactly as the scraper saw it —
no network, no database:

```bash
docker exec <scraper> ls /cache
docker exec <scraper> npm run inspect -- /cache/<file>.html
```

It prints which JSON layers the page has and every row the parser got out,
which separates "the parser is wrong" from "the page never arrived". For a
roster it also prints which extraction won (`nextdata/tuples` vs
`nextdata/objects` vs `dom`) — the JSON layer alone doesn't say, and a run
guessing its way to a plausible-looking roster used to log identically to a
correct one. When a stats or box-score page yields nothing, it dumps the
page's positional-tuple arrays slot by slot, which is everything needed to
aim a parser at them.

### Capturing real pages

To fix a parser properly you need the HTML MaxPreps actually served:

```bash
cd scraper
npm run capture                      # current season, varsity
npm run capture -- jv                # current season, JV
npm run capture -- varsity 24-25     # any historical season
```

Files land in `scraper/captured/` (not gitignored — commit them if you want
them reviewed) and each one prints which JSON layers it contains. Captures
include student athletes' names; they're public pages, but treat a capture
like the roster it is.

### Re-parsing without re-scraping

Every fetched page is cached (volume `scrapecache`, env `SCRAPE_CACHE_DIR`).
After fixing a parser you can re-run the whole backfill **from cache**
without touching maxpreps.com:

```bash
npm run reparse
```

### Repairing a season that imported badly

Upserts can add and correct rows but never remove one, so a game stored
under a URL the schedule no longer lists — or a player invented by a bad
parse — survives every re-run. `--prune` reconciles instead: after a season
scrapes cleanly it deletes that season's rows the run didn't see.

```bash
npm run backfill -- --prune     # every season
npm start -- --prune            # current season only
```

It's season-scoped and refuses to prune a roster it parsed as empty, so a
failed fetch can't wipe history. Check the run's warnings first — pruning
against a bad parse just replaces stale wrong rows with fresh wrong ones.

## Is what I'm looking at real?

The dashboard serves a **fictional demo dataset** whenever the `games` table
is empty, so the UI is explorable before the first scrape. Pages show a pink
"Sample data" banner when that happens — if you see it, none of the players,
opponents or scores on screen came from MaxPreps.

The check is `SELECT 1 FROM games LIMIT 1`, so it is all-or-nothing on games.
A database with games but no rosters is *real* data and gets no banner; the
Players page explains that the roster is empty rather than rendering a blank
table.

## Repo layout

```text
docker-compose.yml          # build from source (local dev)
portainer-stack.yml         # prebuilt ghcr.io images (deploys)
.github/workflows/publish-images.yml   # checks -> build -> push to Packages
db/schema.sql               # applied automatically on first Postgres boot
db/Dockerfile               # postgres:17-alpine + the schema baked in
scraper/
  src/config.ts             # team URLs, season slugs, politeness delay
  src/parse/nextdata.ts     # embedded-JSON extraction (all layers) + deep search
  src/parse/datetime.ts     # kickoff times + timezone-correct dates
  src/parse/names.ts        # player-name canonicalization (the join key)
  src/parse/schedule.ts     # games/results   (JSON-first, DOM fallback)
  src/parse/roster.ts       # players         (JSON-first, DOM fallback)
  src/parse/stats.ts        # season stat lines + STAT_COLUMN_MAP
  src/parse/boxscore.ts     # per-game player lines (best effort)
  src/verify.ts             # live diagnostic (npm run verify)
  src/capture.ts            # save raw page HTML (npm run capture)
  src/inspect.ts            # parse a local HTML file (npm run inspect)
  test/                     # fixture tests for both parser layers
dashboard/
  app/                      # Overview, Schedule, Players, Players/[id], History
  components/charts/        # custom SVG charts (trend, margins, record stack)
  lib/demo.ts               # bannered sample dataset (fictional players)
  lib/data.ts               # Postgres reads with automatic demo fallback
```

## Which seasons get scraped

The scraper reads MaxPreps' own season picker off the team home page. That
payload states every level and year that exists, plus the canonical URL for
each, so nothing is guessed:

```text
[run] discovered 71 published season/level combos from the site's season picker
      (levels: freshman, jv, varsity); scraping 6
```

This is what makes a freshman squad appear on its own (NorthWood added one in
26-27) and what removes the bare-vs-slugged URL problem below. If the picker
can't be read, the run falls back to generated slugs and says so.

## Season rollover

MaxPreps serves the current season from the bare URL (`…/soccer/girls/schedule/`)
and every other season from a slugged one (`…/soccer/girls/24-25/schedule/`),
so which season counts as "current" decides which URL gets fetched. The
cutover is July 1.

`currentSeasonSlug()` / `seasonSlugs()` in `scraper/src/config.ts` are
**functions, evaluated per run, not constants**. That is deliberate: the
scraper is a single long-lived process with a daily cron, so a value frozen
at import time would outlive the rollover. A container started in June would
still call the old year "current" in August — fetching the new season's page
from the bare URL, filing its games under the old season's row, and never
scraping the new season at all.

Daily runs scrape the current season **and the previous one**, since box
scores and final stat lines get entered days after the last whistle, and
because the new season's page may not exist yet in early July.

## Notes

- **Levels are data, not hardcoded**: to track a freshman squad someday, add
  `"freshman"` to `TEAM_LEVELS` + a base URL in `scraper/src/config.ts`.
  Schema, dashboard toggle, and queries already handle it.
- **Politeness**: the scraper waits 1.5s between requests and runs once a
  day. A full two-level, 17-season backfill takes a few minutes by design.
- **Team colors are sampled, not guessed**: red `#ba0513`, black `#040404`,
  white `#fefefe`, grays `#dedede` / `#949494`, all taken off NorthWood's
  printed Back-to-School Hub sheet. Every neutral on that sheet measures
  R-B = 0, so the dashboard's neutrals carry no warm or cool cast either.
  Two values are intentionally off-sample for legibility on a backlit
  screen — body text sits at `#0d0d0d` rather than pure black, and
  text-bearing gray at `#5e5e5e`, because the sheet's mid gray is a
  halftone value that only reaches 2.9:1 on white. All of it lives in
  `app/globals.css` as tokens; the night edition restates the same
  palette and nothing else needs to know which edition is rendering.
- **Type**: Barlow Condensed for headings (standing in for the condensed
  grotesque the school sets its headlines in), IBM Plex Mono for every
  stat, date and axis label, Manrope for UI text, Kaushan Script for the
  motto in the footer.
- Charts use red for NorthWood and a dashed neutral line for opponents;
  win/loss/tie marks always carry a letter, never color alone.
- **Contrast is checked, not assumed**: every rendered text node on all
  four pages is measured against its computed background in both
  editions — 702 nodes each, all at or above 4.5:1 (3:1 for large
  display type and chart marks). Worth re-running after palette edits.
- The real crest isn't bundled — drop it into `dashboard/public/` and swap
  it into `components/TopBar.tsx` if you want it in the masthead. The
  panther head and paw from the school's sheet would be the ones to use.
