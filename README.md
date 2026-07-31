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

`latest` only moves for `main`; branch pushes get `:<branch>`, every build
also gets `:sha-<short>`, and a `vX.Y.Z` tag publishes `:X.Y.Z` + `:X.Y` so
you can pin or roll back by setting `IMAGE_TAG` on the stack.

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
5. Dashboard is at `http://<host>:3300` — put it behind your reverse proxy /
   Tailscale like your other services.

### Pulling the latest build

Once the workflow is green, in Portainer: **Stacks → northwood → Update the
stack**, tick **Re-pull image and redeploy**, Update. That repoints all three
services at the current `:latest`. Postgres keeps its `pgdata` volume, so
only the code changes.

## ⚠️ Verify the scraper before trusting a backfill

This project was built in a sandbox that **cannot reach maxpreps.com**, so
the parsers could not be run against the live site. They are built to be
resilient — every parser reads MaxPreps' embedded `__NEXT_DATA__` JSON first
(survives CSS/markup redesigns) and only falls back to DOM scraping — and
they're covered by fixture tests (`cd scraper && npm test`). But before the
first real run, spend two minutes verifying from a machine that can reach
the site:

```bash
cd scraper
npm install
npm run verify                  # current season, varsity
npm run verify -- jv            # current season, JV
npm run verify -- varsity 24-25 # any historical season
```

`verify` fetches one season's schedule/roster/stats/box-score pages, prints
exactly what each parser layer found (and via which layer: `nextdata` or
`dom`), and — if a parser comes up empty — dumps the page's `__NEXT_DATA__`
key structure so re-aiming the shape predicates in `scraper/src/parse/*.ts`
is quick. It never writes to the database.

Things `verify` may surface:

- **Unmapped stat columns** (e.g. a header abbreviation not in
  `STAT_COLUMN_MAP` in `src/parse/stats.ts`) — add the mapping and re-run.
  Unknown columns are skipped, never guessed.
- **0 games parsed** — the shape predicates need re-aiming; the printed
  `pageProps` key list shows where the contest array actually lives.
- **No box score lines** — many games simply have none entered on MaxPreps;
  try another game's URL before assuming the parser is wrong.

### Re-parsing without re-scraping

Every fetched page is cached (volume `scrapecache`, env `SCRAPE_CACHE_DIR`).
After fixing a parser you can re-run the whole backfill **from cache**
without touching maxpreps.com:

```bash
npm run reparse
```

## Repo layout

```text
docker-compose.yml          # build from source (local dev)
portainer-stack.yml         # prebuilt ghcr.io images (deploys)
.github/workflows/publish-images.yml   # checks -> build -> push to Packages
db/schema.sql               # applied automatically on first Postgres boot
db/Dockerfile               # postgres:17-alpine + the schema baked in
scraper/
  src/config.ts             # team URLs, season slugs, politeness delay
  src/parse/nextdata.ts     # __NEXT_DATA__ extraction + deep-search helpers
  src/parse/schedule.ts     # games/results   (JSON-first, DOM fallback)
  src/parse/roster.ts       # players         (JSON-first, DOM fallback)
  src/parse/stats.ts        # season stat lines + STAT_COLUMN_MAP
  src/parse/boxscore.ts     # per-game player lines (best effort)
  src/verify.ts             # live diagnostic (npm run verify)
  test/                     # fixture tests for both parser layers
dashboard/
  app/                      # Overview, Schedule, Players, Players/[id], History
  components/charts/        # custom SVG charts (trend, margins, record stack)
  lib/demo.ts               # bannered sample dataset (fictional players)
  lib/data.ts               # Postgres reads with automatic demo fallback
```

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
