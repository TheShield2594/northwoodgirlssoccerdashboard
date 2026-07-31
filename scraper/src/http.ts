import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { request } from "undici";
import { HTTP_HEADERS, REQUEST_DELAY_MS } from "./config.js";

const CACHE_DIR = process.env.SCRAPE_CACHE_DIR || "";
const FROM_CACHE = process.argv.includes("--from-cache");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cachePath(url: string): string {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const slug = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .slice(0, 120);
  return join(CACHE_DIR, `${slug}.${hash}.html`);
}

/**
 * Fetch a page's HTML with a fixed delay afterward to keep request
 * frequency low. Returns null on 404 (common for seasons where JV didn't
 * exist, or before the program had a page) instead of throwing.
 *
 * Every successful fetch is also written to SCRAPE_CACHE_DIR (if set), so
 * parser fixes can be re-applied with `npm run reparse` without touching
 * maxpreps.com again. With --from-cache, only the cache is read.
 */
export async function fetchHtml(url: string): Promise<string | null> {
  if (CACHE_DIR && FROM_CACHE) {
    try {
      return await readFile(cachePath(url), "utf8");
    } catch {
      return null; // never cached (e.g. was a 404 originally)
    }
  }

  let res;
  try {
    res = await request(url, { headers: HTTP_HEADERS, maxRedirections: 5 });
  } catch (err) {
    console.warn(`[http] network error fetching ${url}:`, (err as Error).message);
    await sleep(REQUEST_DELAY_MS);
    return null;
  }

  if (res.statusCode === 404) {
    await res.body.dump();
    await sleep(REQUEST_DELAY_MS);
    return null;
  }
  if (res.statusCode >= 400) {
    console.warn(`[http] ${res.statusCode} fetching ${url}`);
    await res.body.dump();
    await sleep(REQUEST_DELAY_MS);
    return null;
  }

  const html = await res.body.text();

  if (CACHE_DIR) {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cachePath(url), html, "utf8");
    } catch (err) {
      console.warn(`[http] cache write failed:`, (err as Error).message);
    }
  }

  await sleep(REQUEST_DELAY_MS);
  return html;
}
