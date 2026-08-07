import { STAT_FULL_NAMES, STAT_LABELS } from "@/lib/types";

/**
 * Expandable key for the stat abbreviations in a table header.
 *
 * These were explained only through `title` attributes on the `<th>`, which
 * is a hover tooltip — it does nothing on a touch screen, where most of this
 * audience is, and `title` on a header cell is announced inconsistently by
 * screen readers. SH / SOG / GWG / SV / GAA are not common knowledge.
 */
export default function ColumnKey({ keys }: { keys: string[] }) {
  const known = keys.filter((k) => STAT_FULL_NAMES[k]);
  if (known.length === 0) return null;

  return (
    <details className="col-key">
      <summary>What the columns mean</summary>
      <dl>
        {known.map((k) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{STAT_LABELS[k] ?? k}</dt>
            <dd>{STAT_FULL_NAMES[k]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
