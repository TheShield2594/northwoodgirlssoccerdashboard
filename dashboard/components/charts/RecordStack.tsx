"use client";

/**
 * Program history: one stacked column per season (wins red, ties gray,
 * losses ink) with a 2px surface gap between segments, hover tooltip,
 * and a season label under each column.
 *
 * Sizes to its container so the season labels stay readable on phones.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { labelStride, niceScale, tickAnchor, useChartWidth } from "./useChartWidth";

export interface SeasonColumn {
  label: string;      // "'25"
  title: string;      // "Fall 2025"
  wins: number;
  losses: number;
  ties: number;
  href?: string;
}

export default function RecordStack({ columns, ariaLabel }: { columns: SeasonColumn[]; ariaLabel: string }) {
  const router = useRouter();
  const { ref, width: W } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  const narrow = W < 460;
  const H = narrow ? 200 : 240;
  const PAD = { top: 18, right: 12, bottom: 26, left: narrow ? 26 : 30 };

  if (columns.length === 0) return null;

  const innerW = Math.max(40, W - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const yScale = niceScale(Math.max(...columns.map((c) => c.wins + c.losses + c.ties), 1));
  const maxTotal = yScale.max;
  const slot = innerW / columns.length;
  const barW = Math.min(34, Math.max(6, slot - 8));
  const x = (i: number) => PAD.left + i * slot + (slot - barW) / 2;
  const hScale = innerH / maxTotal;

  const yTicks = yScale.ticks;
  // With 17 seasons on a phone, every other label is all that fits.
  const step = labelStride(columns.length, innerW, narrow ? 26 : 34);
  const hp = hover !== null ? columns[hover] : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} role="img" aria-label={ariaLabel}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom - t * hScale} y2={H - PAD.bottom - t * hScale} stroke="var(--hair)" strokeWidth={1} />
            <text x={PAD.left - 6} y={H - PAD.bottom - t * hScale + 3} fontSize={10} fill="var(--muted)" textAnchor="end" fontFamily="var(--font-mono)">{t}</text>
          </g>
        ))}

        {columns.map((c, i) => {
          const segs: { v: number; color: string }[] = [
            { v: c.wins, color: "var(--win)" },
            { v: c.ties, color: "var(--tie)" },
            // Losses stay on --loss. Softening them to a gray (so the palette's
            // heaviest value doesn't land on the worst outcome) puts them next
            // to --tie, which is already gray: two of the three categories stop
            // being tellable apart, and any gray light enough to read as
            // "secondary" drops under 3:1 against the card. Categorical
            // separation wins over the tonal balance here.
            { v: c.losses, color: "var(--loss)" },
          ].filter((s) => s.v > 0);
          let yCursor = H - PAD.bottom;
          const dim = hover !== null && hover !== i;
          return (
            <g key={i}
               onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
               onFocus={() => setHover(i)} onBlur={() => setHover(null)}
               style={{ cursor: c.href ? "pointer" : "default" }}
               tabIndex={c.href ? 0 : undefined}
               role={c.href ? "link" : undefined}
               aria-label={c.href ? `${c.title}: ${c.wins} wins, ${c.losses} losses, ${c.ties} ties` : undefined}
               onClick={() => { if (c.href) router.push(c.href); }}
               onKeyDown={(e) => {
                 if (c.href && (e.key === "Enter" || e.key === " ")) {
                   e.preventDefault();
                   router.push(c.href);
                 }
               }}>
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {segs.map((s, j) => {
                const h = Math.max(2, s.v * hScale - 2); // 2px gap between segments
                yCursor -= s.v * hScale;
                return (
                  <rect key={j} x={x(i)} y={yCursor + 1} width={barW} height={h}
                        fill={s.color} opacity={dim ? 0.4 : 1}
                        rx={j === segs.length - 1 ? 3 : 1.5} />
                );
              })}
              {(i % step === 0 || hover === i) && (
                <text x={PAD.left + i * slot + slot / 2} y={H - 7} fontSize={10}
                      fill={hover === i ? "var(--ink)" : "var(--muted)"} textAnchor={tickAnchor(i, columns.length)} fontFamily="var(--font-mono)">
                  {c.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hp && hover !== null && (
        <div className="chart-tip"
             style={{
               left: `${((PAD.left + hover * slot + slot / 2) / W) * 100}%`,
               top: 0,
               transform: `translate(${hover > columns.length / 2 ? "calc(-100% - 10px)" : "10px"}, 0)`,
             }}>
          <div className="tt-title">{hp.title}</div>
          <div className="tt-row"><span className="tt-swatch" style={{ background: "var(--win)" }} />Wins<span className="tt-val">{hp.wins}</span></div>
          <div className="tt-row"><span className="tt-swatch" style={{ background: "var(--tie)" }} />Ties<span className="tt-val">{hp.ties}</span></div>
          <div className="tt-row"><span className="tt-swatch" style={{ background: "var(--loss)" }} />Losses<span className="tt-val">{hp.losses}</span></div>
        </div>
      )}

      <div className="legend" style={{ marginTop: 8 }}>
        <span className="l-item"><span className="l-swatch square" style={{ background: "var(--win)" }} /> Wins</span>
        <span className="l-item"><span className="l-swatch square" style={{ background: "var(--tie)" }} /> Ties</span>
        <span className="l-item"><span className="l-swatch square" style={{ background: "var(--loss)" }} /> Losses</span>
      </div>
    </div>
  );
}
