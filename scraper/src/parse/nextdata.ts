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
