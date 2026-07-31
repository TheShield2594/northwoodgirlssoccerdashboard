"use client";

/**
 * Goal margin by game: bars above the baseline are wins (red), below are
 * losses (ink), ties sit as small gray squares on the line. Position +
 * letter in the tooltip carry the meaning alongside color.
 *
 * Sizes to its container so axis labels stay at true pixel size on phones.
 */
import { useState } from "react";
import { labelStride, useChartWidth } from "./useChartWidth";

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
  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.margin)));
  const zeroY = PAD.top + innerH / 2;
  const scale = innerH / 2 / maxAbs;

  const slot = innerW / points.length;
  const barW = Math.min(22, Math.max(4, slot - 2)); // 2px surface gap between bars
  const x = (i: number) => PAD.left + i * slot + (slot - barW) / 2;

  const step = labelStride(points.length, innerW, narrow ? 38 : 46);
  const color = (r: "W" | "L" | "T") => (r === "W" ? "var(--win)" : r === "L" ? "var(--loss)" : "var(--tie)");
  const hp = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} role="img" aria-label={ariaLabel}>
        {[maxAbs, 0, -maxAbs].map((t) => (
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
                <rect x={bx} y={zeroY - 3} width={barW} height={6} rx={2} fill={color("T")} opacity={hover === i ? 1 : 0.9} />
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
                <text x={PAD.left + i * slot + slot / 2} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor="middle" fontFamily="var(--font-mono)">
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
