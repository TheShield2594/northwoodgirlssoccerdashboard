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

1. Push this repo somewhere Portainer can reach (or upload the compose file).
2. **Stacks → Add stack → Repository**, point at this repo.
3. Set the `POSTGRES_PASSWORD` environment variable in the stack config
   (defaults to `northwood` — change it).
4. Deploy. Postgres applies `db/schema.sql` on first boot.
5. Exec into the `scraper` container and run the one-time historical
   backfill:

   ```bash
   npm run backfill
   ```

   The daily 6am cron keeps the current season fresh afterward.
6. Dashboard is at `http://<host>:3300` — put it behind your reverse proxy /
   Tailscale like your other services.

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

```
docker-compose.yml
db/schema.sql               # applied automatically on first Postgres boot
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
- **Team colors**: red `#b3121f`, black, paper-white (gray as support).
  Charts use red for NorthWood and a dashed neutral ink line for opponents;
  win/loss/tie marks always carry a letter, never color alone.
- The real crest isn't bundled — drop it into `dashboard/public/` and swap
  it into `components/TopBar.tsx` if you want it in the masthead.
