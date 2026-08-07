"use client";

/**
 * Goal margin by game: bars above the baseline are wins (red), below are
 * losses (ink), ties sit as small gray squares on the line. Position +
 * letter in the tooltip carry the meaning alongside color.
 *
 * Sizes to its container so axis labels stay at true pixel size on phones.
 */
import { useState } from "react";
import { labelStride, tickAnchor, useChartWidth } from "./useChartWidth";

export interface MarginPoint {
  label: string;   // x label "8/16"
  title: string;   // "vs Warsaw · 8/21"
  margin: number;  // teamScore - opponentScore
  result: "W" | "L" | "T";
  score: string;   // "2-1"
}

const hpLabel = (p: MarginPoint) =>
  `${p.title}: ${p.result === "W" ? "win" : p.result === "L" ? "loss" : "tie"} ${p.score}`;

export default function MarginBars({ points, ariaLabel }: { points: MarginPoint[]; ariaLabel: string }) {
  const { ref, width: W } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  const narrow = W < 460;
  const H = narrow ? 168 : 190;
  const PAD = { top: 16, right: 12, bottom: 24, left: narrow ? 26 : 30 };

  if (points.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>No completed games yet.</p>;
  }

  const innerW = Math.max(40, W - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;

  // Domain from the margins actually present, not a forced +/-maxAbs. A
  // season with no losses used to spend its whole lower half on empty space
  // and draw every bar at half the resolution it had room for — so the
  // better the season, the smaller the chart. The zero line lands wherever
  // the data puts it.
  let hi = Math.max(0, ...points.map((p) => p.margin));
  let lo = Math.min(0, ...points.map((p) => p.margin));
  if (hi === 0 && lo === 0) { hi = 1; lo = -1; } // all draws: keep zero centred
  const span = hi - lo;
  const zeroY = PAD.top + (hi / span) * innerH;
  const scale = innerH / span;

  // A tie sits astride the zero rule, but zero is only mid-plot when the
  // season has margins on both sides of it. With no losses zero IS the
  // bottom edge (and with no wins, the top), so the marker is clamped inside
  // the plot rather than hanging into the x-axis gutter or over the top.
  const TIE_H = 10;
  const tieY = Math.min(
    Math.max(zeroY - TIE_H / 2, PAD.top),
    PAD.top + innerH - TIE_H
  );

  const slot = innerW / points.length;
  const barW = Math.min(22, Math.max(4, slot - 2)); // 2px surface gap between bars
  const x = (i: number) => PAD.left + i * slot + (slot - barW) / 2;

  const step = labelStride(points.length, innerW, narrow ? 38 : 46);
  const color = (r: "W" | "L" | "T") => (r === "W" ? "var(--win)" : r === "L" ? "var(--loss)" : "var(--tie)");
  const hp = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} role="img" aria-label={ariaLabel}>
        {[...new Set([hi, 0, lo])].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={zeroY - t * scale} y2={zeroY - t * scale} stroke={t === 0 ? "var(--hair-strong)" : "var(--hair)"} strokeWidth={1} />
            <text x={PAD.left - 6} y={zeroY - t * scale + 3} fontSize={10} fill="var(--muted)" textAnchor="end" fontFamily="var(--font-mono)">
              {t > 0 ? `+${t}` : t}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          const h = Math.abs(p.margin) * scale;
          const isTie = p.result === "T";
          const bx = x(i);
          const by = p.margin >= 0 ? zeroY - h : zeroY;
          return (
            <g key={i}
               tabIndex={0}
               aria-label={`${hpLabel(p)}`}
               onMouseEnter={() => setHover(i)}
               onMouseLeave={() => setHover(null)}
               onFocus={() => setHover(i)}
               onBlur={() => setHover(null)}>
              {/* generous invisible hit target */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {isTie ? (
                /* A tie is a real data point at zero, not part of the axis —
                   given a visible height and held off the rule by a surface
                   -colored outline so it can't be mistaken for it. */
                <rect x={bx} y={tieY} width={barW} height={TIE_H} rx={2.5}
                      fill={color("T")} stroke="var(--card)" strokeWidth={1}
                      opacity={hover === null || hover === i ? 1 : 0.45} />
              ) : (
                <rect
                  x={bx}
                  y={by}
                  width={barW}
                  height={Math.max(3, h)}
                  fill={color(p.result)}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  rx={2.5}
                />
              )}
              {i % step === 0 && (
                <text x={PAD.left + i * slot + slot / 2} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor={tickAnchor(i, points.length)} fontFamily="var(--font-mono)">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hp && hover !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${((PAD.left + hover * slot + slot / 2) / W) * 100}%`,
            top: 0,
            transform: `translate(${hover > points.length / 2 ? "calc(-100% - 10px)" : "10px"}, 0)`,
          }}
        >
          <div className="tt-title">{hp.title}</div>
          <div className="tt-row">
            <span className="tt-swatch" style={{ background: color(hp.result) }} />
            {hp.result === "W" ? "Win" : hp.result === "L" ? "Loss" : "Tie"} {hp.score}
            <span className="tt-val">{hp.margin > 0 ? `+${hp.margin}` : hp.margin}</span>
          </div>
        </div>
      )}

      <div className="legend" style={{ marginTop: 8 }}>
        <span className="l-item"><span className="l-swatch square" style={{ background: "var(--win)" }} /> Win</span>
        <span className="l-item"><span className="l-swatch square" style={{ background: "var(--loss)" }} /> Loss</span>
        <span className="l-item"><span className="l-swatch square" style={{ background: "var(--tie)" }} /> Tie</span>
      </div>
    </div>
  );
}
