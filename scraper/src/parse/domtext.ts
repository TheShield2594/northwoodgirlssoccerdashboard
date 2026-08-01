import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * Read an element's text with a guaranteed space between every text node.
 *
 * `.text()` concatenates, and MaxPreps rows put separate facts in adjacent
 * elements with no whitespace between them, so a date cell followed by a time
 * becomes one run:
 *
 *     <td><a>9/3</a><div>6:45pm</div></td>   ->  .text() === "9/36:45pm"
 *
 * The date regex then reads that as month 9, day 36 and the row is dropped.
 * Worse, a two-digit day parses as a *valid* date — "9/12" + "7:15pm" gives
 * "9/127:15pm", where the date matches "9/12" and the time is silently lost
 * to the digit right before it. Same bug, but it produces a plausible row
 * with a missing kickoff instead of an obvious failure.
 *
 * Joining the row's immediate children is not enough, because the date and
 * the time usually live inside the *same* cell. This walks all the way down
 * to text nodes, in document order.
 */
export function domText($: cheerio.CheerioAPI, sel: cheerio.Cheerio<AnyNode>): string {
  const parts: string[] = [];
  for (const node of sel.toArray()) collect($, node, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collect($: cheerio.CheerioAPI, node: AnyNode, out: string[]): void {
  for (const child of $(node).contents().toArray()) {
    if (child.type === "text") {
      const text = (child as { data?: string }).data?.trim();
      if (text) out.push(text);
    } else if (child.type === "tag") {
      const tag = (child as { name?: string }).name;
      if (tag === "script" || tag === "style") continue;
      collect($, child, out);
    }
  }
}
