import * as cheerio from "cheerio";

/**
 * MaxPreps is a Next.js site: every page embeds the data it rendered from
 * in a <script id="__NEXT_DATA__"> JSON blob. Parsing that JSON is far
 * more resilient than scraping the DOM (CSS classes churn constantly;
 * the underlying data fields rarely do), so every parser in this project
 * tries the JSON first and only falls back to HTML tables.
 *
 * We deliberately do NOT hardcode the exact JSON paths (they shift between
 * deployments too). Instead we deep-walk the whole tree and pick out
 * objects that structurally look like the thing we want — a game, a roster
 * entry, a stat row. See the shape predicates in schedule.ts / roster.ts /
 * stats.ts.
 */
export function extractNextData(html: string): unknown | null {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").first().text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Where a JSON root came from, for logging and for `verify` diagnostics. */
export type JsonSourceKind = "nextdata" | "flight" | "ldjson" | "json-script";

/** Which layer a parse result came out of. "dom" means every JSON layer
 *  missed and we are guessing from markup — treat those rows with suspicion. */
export type ParseSource = JsonSourceKind | "dom" | "none";

export interface JsonSource {
  kind: JsonSourceKind;
  root: unknown;
}

/**
 * Every embedded-JSON layer a Next.js page might use, best first.
 *
 * `__NEXT_DATA__` only exists on the Pages Router. An App Router page ships
 * its data as a React Server Component "flight" payload instead — a series
 * of `self.__next_f.push([1,"…"])` calls whose string arguments concatenate
 * into one stream of JSON fragments. A site that migrates routers therefore
 * loses `__NEXT_DATA__` overnight, and a scraper that only knows that one
 * shape silently drops to its DOM fallback and starts emitting garbage
 * rather than failing loudly. So: try them all, and report which one hit.
 */
export function extractJsonSources(html: string): JsonSource[] {
  const sources: JsonSource[] = [];

  const nextData = extractNextData(html);
  if (nextData) sources.push({ kind: "nextdata", root: nextData });

  const flight = decodeFlightPayload(html);
  if (flight) {
    const fragments = extractJsonFragments(flight);
    // One root holding every fragment: deepFindObjects walks arrays, so a
    // single pass covers them all.
    if (fragments.length > 0) sources.push({ kind: "flight", root: fragments });
  }

  const $ = cheerio.load(html);

  const ld: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const parsed = tryParse($(el).text());
    if (parsed !== undefined) ld.push(parsed);
  });
  if (ld.length > 0) sources.push({ kind: "ldjson", root: ld });

  // Any other JSON island (Apollo caches, `__NEXT_DATA__`-alikes, per-widget
  // payloads). Skip the two handled above.
  const other: unknown[] = [];
  $('script[type="application/json"]').each((_, el) => {
    if ($(el).attr("id") === "__NEXT_DATA__") return;
    const parsed = tryParse($(el).text());
    if (parsed !== undefined) other.push(parsed);
  });
  if (other.length > 0) sources.push({ kind: "json-script", root: other });

  return sources;
}

function tryParse(raw: string): unknown | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Concatenate the App Router flight payload out of its `self.__next_f.push`
 * calls. The chunks are split at arbitrary byte offsets — often mid-JSON,
 * sometimes mid-string — so they must be joined before anything is parsed.
 */
export function decodeFlightPayload(html: string): string | null {
  const MARKER = "self.__next_f.push(";
  const chunks: string[] = [];

  // A dropped chunk leaves a hole mid-JSON, so the rest of the stream can
  // fail to parse for reasons that look like a bad predicate. Count them.
  let dropped = 0;

  let at = html.indexOf(MARKER);
  while (at !== -1) {
    let i = at + MARKER.length;
    while (i < html.length && /\s/.test(html[i])) i++;
    const end = html[i] === "[" ? scanBalanced(html, i) : -1;
    const arr = end === -1 ? undefined : tryParse(html.slice(i, end));
    // push([1, "<chunk>"]) — other tags (0 = bootstrap) carry no data and are
    // not a loss; anything else we failed to read is.
    if (Array.isArray(arr)) {
      if (typeof arr[1] === "string") chunks.push(arr[1]);
    } else {
      dropped++;
    }
    at = html.indexOf(MARKER, at + MARKER.length);
  }

  if (dropped > 0) {
    console.warn(
      `[nextdata] ${dropped} flight chunk(s) could not be read — the reassembled payload is incomplete`
    );
  }

  return chunks.length > 0 ? chunks.join("") : null;
}

/**
 * Index just past the JSON value starting at `text[start]` (a `{` or `[`),
 * or -1 if it never closes. String-aware, so brackets inside string literals
 * don't throw the depth off. Because JSON nests properly, counting only the
 * opening character's own type is sufficient.
 */
function scanBalanced(text: string, start: number): number {
  const open = text[start];
  if (open !== "{" && open !== "[") return -1;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Pull every parseable JSON object out of a flight stream. The stream is not
 * itself JSON — it is line-oriented rows like `12:["$","div",null,{…}]` — so
 * we scan for object starts and keep whatever parses, skipping past each hit
 * so nested objects aren't re-emitted on their own.
 */
export function extractJsonFragments(text: string, maxFragments = 5000): unknown[] {
  const fragments: unknown[] = [];
  let at = text.indexOf('{"');

  while (at !== -1 && fragments.length < maxFragments) {
    const end = scanBalanced(text, at);
    let next = at + 2;
    if (end !== -1) {
      const parsed = tryParse(text.slice(at, end));
      if (parsed !== undefined) {
        fragments.push(parsed);
        next = end; // whole subtree captured; don't re-scan its children
      }
    }
    at = text.indexOf('{"', next);
  }

  if (fragments.length >= maxFragments) {
    console.warn(
      `[nextdata] stopped at the ${maxFragments}-fragment cap — the flight payload was not fully searched`
    );
  }

  return fragments;
}

export interface FoundObject {
  path: string; // dotted path from the root, for diagnostics
  value: Record<string, unknown>;
}

/**
 * Walk the entire JSON tree and return every object for which `predicate`
 * returns true. Cycle-safe, depth-capped. The path is kept so `verify.ts`
 * can print where matches were found — that makes fixing a drifted
 * predicate a 2-minute job instead of spelunking.
 */
export function deepFindObjects(
  root: unknown,
  predicate: (obj: Record<string, unknown>) => boolean,
  maxDepth = 24
): FoundObject[] {
  const found: FoundObject[] = [];
  const seen = new Set<object>();

  function walk(node: unknown, path: string, depth: number) {
    if (depth > maxDepth || node === null || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }

    const obj = node as Record<string, unknown>;
    if (predicate(obj)) found.push({ path, value: obj });
    for (const [key, value] of Object.entries(obj)) {
      walk(value, path ? `${path}.${key}` : key, depth + 1);
    }
  }

  walk(root, "", 0);
  return found;
}

/** Case-insensitive lookup of the first present key from a list. */
export function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const real = lower.get(key.toLowerCase());
    if (real !== undefined && obj[real] !== null && obj[real] !== undefined) {
      return obj[real];
    }
  }
  return undefined;
}

export function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // Strict: strip thousands separators and one trailing %, then the
    // WHOLE remainder must be numeric. parseFloat would happily turn
    // "8-0" into 8 or "12/18" into 12 — reject those.
    const cleaned = v.trim().replace(/,/g, "").replace(/%$/, "");
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) return parseFloat(cleaned);
  }
  return null;
}

/**
 * Resolve an href from scraped markup/JSON to an absolute maxpreps URL.
 * Handles absolute, protocol-relative, and path-relative forms; returns
 * null for anything unusable.
 */
export function absoluteUrl(href: string | null | undefined): string | null {
  if (!href || typeof href !== "string" || href.trim() === "") return null;
  try {
    return new URL(href, "https://www.maxpreps.com").toString();
  } catch {
    return null;
  }
}
