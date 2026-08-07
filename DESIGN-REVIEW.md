# Design review — NorthWood Girls Soccer dashboard

A UI/UX review of the `dashboard/` app: every page, both color schemes, desktop
(1440px) and phone (390px). Findings come from reading the source *and* from
rendering the running app against the demo dataset, so each one below is
something that is actually on screen, not something inferred from CSS.

Findings are ordered by how much they cost a real visitor, not by how hard they
are to fix.

---

## What the design gets right

Worth stating plainly, because it sets the bar the rest of the review is
measured against.

- **The palette is real.** Every text/surface pair I measured clears WCAG AA in
  both editions — `--muted` on card (6.48:1 light / 6.50:1 dark), the tie chip
  (5.10 / 6.57), `--on-red-dim` on the red header bar (5.30 / 4.56), the jersey
  chip (11.29 / 6.31). The day/night restatement of the brand red — `#ba0513` →
  `#f74f5c`, same 355° hue — is the right call and it holds.
- **Color is never load-bearing alone.** W/L/T carry letters; the trend chart
  distinguishes series by dash pattern *and* hue *and* a direct end-of-line
  label. This survives CVD and grayscale printing.
- **The token layer is disciplined.** Components never name a color — they name a
  role. That's why the night edition works at all.
- **Focus is handled better than most production apps.** The halo-plus-outline
  ring, and the two documented exceptions where it lands on red or near-black,
  are correct. I tabbed through it; it's visible everywhere.
- **The typographic system is coherent.** Condensed display / Manrope UI / Plex
  Mono for figures, with tabular numerals on every stat. Numbers align in
  columns, which is the whole job on a stats site.
- **Responsive column-dropping is thought through.** `col-optional` sheds context
  columns and keeps G/A/PTS. The scroll-shadow affordance using
  `background-attachment: local` is a genuinely elegant touch.

The problems below are mostly *state* and *layout* problems, not taste problems.

---

## Critical — the front door is wrong

### 1. The dashboard opens on JV, not Varsity

`resolveSelection()` picks `seasons[0]?.level` as the default
(`lib/derive.ts:88-90`), and `listSeasons()` sorts `ORDER BY season_slug DESC,
level ASC` (`lib/data.ts:33`). `'jv'` sorts before `'varsity'`, so **every
first-time visitor lands on the JV page.** Once a freshman squad exists,
`'freshman'` sorts first and the default moves again — to the *least* prominent
team in the program.

It's visible in every screenshot: the kicker reads `FALL 2025 · JV` and the
segmented control shows JV filled black — while the control itself lists Varsity
first, because `Controls.tsx:26` hardcodes a sensible display order that the
default state doesn't share.

**Fix:** default the level explicitly, mirroring the display order the control
already declares:

```ts
const ORDER: Level[] = ["varsity", "jv", "freshman"];
const level: Level =
  requestedLevel && seasons.some((s) => s.level === requestedLevel)
    ? requestedLevel
    : ORDER.find((l) => seasons.some((s) => s.level === l)) ?? seasons[0]?.level ?? "varsity";
```

Same list, one source of truth — export `ORDER` from `derive.ts` and have
`Controls` import it.

### 2. The upcoming-match list breaks its own dates

`.match-row` fixes the date column at `58px` (`globals.css:614`). The rows are
rendered with `fmtDateLong` — `"Wed, Sep 10"` — which needs ~74px in Plex Mono at
0.7rem. Every date wraps mid-string:

```
Wed, Sep
10          vs Northridge
```

The demo dataset has no in-progress season, so **this never appears in any demo
screenshot** — but it is the home page's primary in-season component, the thing
a parent opens the site to see. It's broken in exactly the state that matters.

**Fix:** `grid-template-columns: minmax(74px, auto) 1fr auto`, or switch this
list to `fmtDateCompact` (`"Sep 10"`) — which also resolves the fact that the
featured row above it and the rows below it currently use two different date
formats inside one card.

While you're in there: the trailing `<span className="chip none">·</span>`
(`app/page.tsx:218`) renders a dashed empty box containing a middot. It reads as
a rendering failure, not as "not played yet". Either drop it or put the kickoff
time in that slot, where it would actually earn its column.

---

## High — the night edition loses its structure

### 3. Cards have no visible edge in dark mode

| pair | light | dark |
|---|---|---|
| card vs paper | 1.10 | **1.12** |
| hairline vs card | 1.35 | **1.28** |
| hairline vs paper | 1.22 | **1.43** |

In light mode the card boundary works because `--hair` (`#dedede`) is *darker*
than both surfaces — the border does the work the fill can't. In dark mode
`--hair` (`#2e2e2e`) is barely lighter than either, so at 1px it disappears.
Look at the dark Players page: the Goalkeepers card has essentially no edge, and
the whole card system dissolves into one flat field. The only cards that still
read as cards are the ones wearing a red header bar.

WCAG 1.4.11 wants 3:1 for meaningful non-text boundaries; this is a quarter of
that.

**Fix:** in the dark block, lift `--hair` to around `#3a3a3a`–`#404040` and
`--card` to `#1e1e1e`. That gets the border to ~1.9:1 against paper and, more to
the point, makes it *visible*. Cards can also carry a very soft outer shadow at
night, which is cheaper than fighting the border contrast.

### 4. The accent tile stops being an accent at night

`.tile.inverse` is the one highlighted tile in a row. In light mode it's a solid
black block against white cards — unmistakable. In dark mode it's `#2c2c2c`
against a `#1a1a1a` card: **1.25:1**. On the Overview, "Clean sheets" goes from
the loudest tile on the page to one you have to hunt for.

Meanwhile the *other* emphasis treatment — `.tile.accent`'s 3px red top border —
survives dark mode fine. So the two treatments swap relative strength between
editions.

**Fix:** give the night version of the inverse tile a red left/top edge or a red
1px border in addition to the lighter fill, so the emphasis is carried by hue
rather than by a luminance step that dark mode can't afford.

**Related:** the Overview tile row uses *both* treatments at once — `accent` on
Win rate, `inverse` on Clean sheets (`app/page.tsx:115,130`). Two competing
"this is the important one" signals in a row of four means neither reads as the
hero. Pick one tile to elevate.

### 5. The schedule's legend describes badges that aren't there on mobile

The page subtitle says *"Conference matches marked **NLC** · postseason marked
**Playoff**"* (`app/schedule/page.tsx:31-34`). Below 620px, `col-optional` hides
the entire Type column — so on a phone the legend explains markers that have
been removed from the page. A visitor scans for NLC badges that structurally
cannot appear.

**Fix (either):** hide the legend line at the same breakpoint, or — better —
keep the signal and drop the column: fold a small `NLC` / `Playoff` marker into
the opponent cell on narrow screens, where it costs one line rather than one
column. Conference standing is the thing parents care about most; it shouldn't
be the first casualty.

The legend is also incomplete on desktop: the table renders four states
(NLC / Playoff / Tourney / Non-conf) and the legend names two.

### 6. Leaderboard links are 19px tap targets

The most-tapped elements on the Overview — the eleven player names across Golden
Boot, Playmakers and Between the Posts — measure **221×19px** on a 390px
viewport. WCAG 2.5.8 asks for 24×24 minimum; comfortable is 44.

**Fix:** make the whole leader row the link (jersey chip + name + value), with
`padding: 8px 0`. That gets you a ~44px target, a much bigger hit area, and it
removes the awkward situation where the jersey chip sits next to a link but
isn't part of it.

---

## Medium — charts and tables

### 7. Y-axis ticks aren't nice numbers, so gridlines are unevenly spaced

`DualTrendChart` computes `yTicks = maxY <= 6 ? [0..maxY] : [0, round(maxY/2),
maxY]` (`DualTrendChart.tsx:62`). With `maxY = 7` that's **0, 4, 7** — so the
top gridline gap is 3 units and the bottom one is 4, but they're drawn at
proportional positions. The chart looks like it has a linear scale with
mis-spaced rules. On History it produces **0, 26, 52**.

Same pattern in `RecordStack` (`0, 8, 16`, which happens to work) and
`MarginBars`.

**Fix:** round the domain up to a nice step before choosing ticks — 1/2/5/10 ×
10ⁿ. Ten lines of code, shared by all three charts:

```ts
function niceMax(v: number, targetTicks = 4) {
  const raw = v / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= raw)! * mag;
  return { max: Math.ceil(v / step) * step, step };
}
```

### 8. The last x-axis label clips off the plot on mobile

Measured on the 390px Overview: the `10/25` tick in Scoring trend overflows the
SVG's right edge by 3px and is visibly cut. Cause: `PAD.right` drops to `12` on
narrow (`DualTrendChart.tsx:38`) while the label is `text-anchor: middle` on the
final point, which sits at exactly `W - PAD.right`.

**Fix:** anchor the first and last ticks `start`/`end` respectively, or reserve
half a label width in the narrow padding (`right: narrow ? 20 : 74`).

### 9. Match margins throws away half the plot

`MarginBars` always draws a symmetric ±`maxAbs` domain (`MarginBars.tsx:38-40`).
For the 12-0-4 season on screen, there is not a single negative margin — so the
entire lower half of the chart is empty, and every bar is squeezed into the top
half at half the resolution it could have. A good season renders as a *smaller*
chart.

**Fix:** compute the domain from the actual min/max with a floor of ±1, keeping
the zero line wherever it lands. Keep the symmetric mode only when both signs
are present, since that's when the symmetry is meaningful.

Also: ties render as a 6px gray sliver on the zero line. At a glance they're
indistinguishable from the axis itself. Give them a visible token height (~10px
centered) or a distinct outline.

### 10. A one-entry leaderboard draws a bar that encodes nothing

"Between the posts" has one keeper. The bar is `value / top`, so it is always
100% wide (`LeaderBoard.tsx:62`). A full-width bar that can never be anything
else is decoration masquerading as data.

**Fix:** skip the bars when `ranked.length < 2`. Same reasoning applies at the
top of every list — the leader's bar is always full — but the comparison to the
rows below it is what makes it legible, and that vanishes at n=1.

The bar track (`--gray-chip`) is also 1.23:1 against the card in light and
**1.17:1** in dark, so at night the bars float with no visible 100% reference.
Lift the track to `--hair` or better.

### 11. Wide tables leave 400px of dead space between related values

On a 1440px viewport the Schedule table stretches the full 1180px shell for six
columns. The date ends around x=465 and the venue marker starts at x=705 — a
240px void — then another long run to Score. Scanning a row means tracking the
eye across nearly a metre of nothing at reading distance. The Players table has
the same shape (name ends ~x=500, Gr starts at x=800).

**Fix:** let the content column absorb the slack instead of distributing it
evenly — `table-layout: auto` with `width: 100%` on the Opponent / Player `th`
and `white-space: nowrap` on the numeric columns. Or cap the table at ~900px
inside the card. Either way the numbers land next to the names they describe.

While there: fold the venue column into the opponent cell (`@ Warsaw` /
`vs Goshen`). It's one glyph occupying a full table column and an empty header.

### 12. The schedule doesn't separate results from fixtures

Played and upcoming games are concatenated into one list
(`app/schedule/page.tsx:20`). Mid-season, the boundary between "what happened"
and "what's next" is the single most important structural break on the page, and
there is no rule, no sticky header, no anchor. A visitor has to read the Result
column to find today.

**Fix:** a labelled divider row (`— Upcoming —`), and jump the page to it on
load. Cheap, and it's the reason people open a schedule.

### 13. Player names don't look clickable

Names in the Players table and the leaderboards are bold ink with no underline,
no color, no icon. The page compensates in copy — *"Click a player for their
game log and career"* (`app/players/page.tsx:91`) — which is the tell: the
instruction exists because the affordance doesn't.

**Fix:** `text-decoration: underline; text-decoration-color: var(--hair-strong);
text-underline-offset: 3px`, going solid `--red` on hover. Then delete the
instruction from the subtitle.

### 14. Stat abbreviations are explained only on hover

`FIELD_COLS` carries a `title` for each header (`app/players/page.tsx:14-21`),
surfaced as a native tooltip. That does nothing on touch — where most of this
audience is — and `title` on `<th>` is announced inconsistently by screen
readers. SH / SOG / GWG / SV / GAA are not universal.

**Fix:** a small collapsible key below the table (`<details><summary>What the
columns mean</summary>`), built from `STAT_FULL_NAMES`, which already exists in
`lib/types.ts` and is currently unused by any page.

### 15. The game log truncates silently

`player.gameLog.slice(-30)` (`app/players/[id]/page.tsx:179`) drops older games
with no note. A 40-game career shows 30 and claims nothing is missing. The card
note says "games with recorded stats", which is true but not the whole truth.

**Fix:** either show all rows (they're already inside a scroll container), or
say "showing the last 30 of 42".

### 16. Empty and error states drop out of the design system

Three pages return a bare paragraph:

```tsx
if (!bundle) return <p>No data for this season.</p>;   // schedule:18, players:37
if (!player) return <p>Player not found.</p>;          // players/[id]:27
```

No heading, no card, no `Controls` — so a visitor who reaches an empty season
has **no control on the page to get out of it** except the browser back button.
The Overview at least keeps the demo banner.

The Players page shows how to do this properly — its no-roster state
(`app/players/page.tsx:101-114`) is a real card that explains *why* the data is
missing. Bring the other three up to that standard, and always render
`<Controls>` so the season picker remains reachable.

---

## Polish — worth doing, none of it urgent

**17. `69-32-18` reads as three separate numbers.** The History all-time tile
wraps the hyphens in `.unit` (`app/history/page.tsx:74-76`), which renders them
smaller and gray. On mobile the separators nearly vanish. Drop the spans — a
win-loss-tie record is one atomic string.

**18. The tile row doesn't share a baseline.** "Best season" overrides to 1.5rem
to fit `12-0-4` (`app/history/page.tsx:81`) while its neighbours stay at 1.9rem,
so four values sit at four different heights. Either shrink the whole row when
any value is long, or bottom-align the values with
`.tile { display: flex; flex-direction: column; }` and a spacer.

**19. Card headers collide on mobile.** `.card-head` is a non-wrapping flex row.
On History at 390px, "SEASON RECORDS" breaks to two lines while "click a column
to open that season" breaks to two lines beside it, and the red bar becomes a
cramped block. Add `flex-wrap: wrap` and hide `.note` below 620px — most notes
are desktop-only hints anyway ("click a column…" describes a hover interaction).

**20. The record card goes ragged on mobile.** The form-dot block keeps
`marginLeft: auto` and `textAlign: right` (`app/page.tsx:98`) after the row wraps
to a column, so "LAST 6 · STREAK T1" hugs the right edge while everything above
it is left-aligned. Reset the alignment at the breakpoint.

**21. Mobile puts two charts ahead of the score.** DOM order is record → tiles →
Scoring trend → Match margins → **Final match** → leaders. On a phone, a fan
opening the site wants the last result and the next fixture first; they currently
scroll past ~900px of analysis to reach it. This is also the screen-reader order.
Reorder the source so the match card follows the tiles, and let the desktop grid
place it right via `grid-row`/`order`.

**22. Losses carry the most visual weight in History.** In `RecordStack`, losses
are `--loss` (near-black by day, near-white by night) — the highest-contrast
value in the palette — while wins wear the mid-contrast red. A bad season looks
*more* emphatic than a good one. Consider losses in `--hair-strong` and let red
dominate; the legend and tooltip already carry identity.

**23. The `Open →` column is redundant.** Eight identical links
(`app/history/page.tsx:155-159`) beside eight season names that could simply *be*
the links — and the chart above already says "click a column to open that
season". Link the season label, drop the column.

**24. There's no "last updated" stamp.** The footer says "Data scraped nightly
from MaxPreps", which is a promise, not a fact. For a scraped dataset, freshness
is the primary trust signal: after a Friday night game, the only question a
visitor has is whether the site has caught up. Surface the max `scraped_at` /
game-updated timestamp in the footer — "Updated Sat, Oct 25, 2:14 AM".

**25. The demo banner is addressed to the wrong reader.** *"Run the scraper
(`npm run backfill` in the scraper container)"* (`components/DemoBanner.tsx:6-7`)
is developer instruction rendered in a public-facing page. If a real visitor ever
sees this banner, it tells them nothing they can act on. Keep the first sentence,
move the runbook to the README.

**26. No column sorting.** On a page titled "Squad & Stats", people expect to
click SH or SOG. The sort is fixed to points, explained in the header note. Not a
defect — but it's the most likely "why can't I…" on the site.

**27. Dark mode's red bar is very loud at full width.** `--red` at `#f74f5c` is
tuned for text and 2px lines; as a 1560×46px fill it's the brightest object on a
near-black page. Consider a separate `--red-fill` token for large areas, a few
steps darker, keeping the bright value for strokes and type.

---

## Suggested order of work

1. **#1** default level, **#2** date wrap — both are on the home page, both are
   small diffs, both are wrong in the states that matter most.
2. **#3, #4** dark-mode surfaces — one token block; restores the card system at
   night.
3. **#5, #6** mobile schedule legend and tap targets.
4. **#7–#12** the chart and table pass — nice scales, domains, clipping, table
   width, played/upcoming split.
5. **#13–#16** affordances and states.
6. Polish as capacity allows.

Nothing here is a rewrite. The system underneath is sound; these are the places
where a specific state, breakpoint, or edition falls out of it.
