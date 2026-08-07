"use client";

/**
 * Two-series trend chart: series A ("for") as a solid red line with a soft
 * area fill, series B ("against") as a dashed ink line. Identity is carried
 * by hue AND line style AND the legend/direct labels, so it survives CVD
 * and grayscale. Crosshair + tooltip on hover.
 *
 * The viewBox tracks the measured container width, so text renders at its
 * true pixel size at every breakpoint.
 */
import { useState } from "react";
import { labelStride, niceScale, tickAnchor, useChartWidth } from "./useChartWidth";

export interface TrendPoint {
  label: string; // x tick label, e.g. "8/16" or "'21"
  title: string; // tooltip title, e.g. "vs Warsaw · 8/21"
  a: number;
  b: number;
}

interface Props {
  points: TrendPoint[];
  aLabel: string;
  bLabel: string;
  ariaLabel: string;
}

export default function DualTrendChart({ points, aLabel, bLabel, ariaLabel }: Props) {
  const { ref, width: W } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  const narrow = W < 460;
  const H = narrow ? 190 : 236;
  // On a phone there isn't room for end-of-line labels; the legend covers it.
  const PAD = {
    top: 18,
    right: narrow ? 12 : 74,
    bottom: 26,
    left: narrow ? 24 : 30,
  };

  if (points.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>No games yet.</p>;
  }

  const innerW = Math.max(40, W - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const scale = niceScale(Math.max(2, ...points.map((p) => Math.max(p.a, p.b))));
  const maxY = scale.max;
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / maxY) * innerH;

  const path = (get: (p: TrendPoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(" ");

  const areaPath =
    path((p) => p.a) +
    ` L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  const step = labelStride(points.length, innerW, narrow ? 38 : 46);
  const yTicks = scale.ticks;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < bestD) { bestD = d; best = i; }
    });
    setHover(best);
  }

  const hp = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: "block", touchAction: "pan-y" }}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--hair)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} fontSize={10} fill="var(--muted)" textAnchor="end" fontFamily="var(--font-mono)">
              {t}
            </text>
          </g>
        ))}

        {/* area + lines */}
        <path d={areaPath} fill="var(--series-for)" opacity={0.07} />
        <path d={path((p) => p.a)} fill="none" stroke="var(--series-for)" strokeWidth={2.2} strokeLinejoin="round" />
        <path d={path((p) => p.b)} fill="none" stroke="var(--series-against)" strokeWidth={1.8} strokeDasharray="5 4" strokeLinejoin="round" />

        {/* direct labels at line ends — only where there's room for them */}
        {!narrow && (
          <>
            <text x={W - PAD.right + 8} y={y(points[points.length - 1].a) + 3} fontSize={10.5} fontWeight={700} fill="var(--series-for)" fontFamily="var(--font-ui)">
              {aLabel}
            </text>
            <text x={W - PAD.right + 8} y={y(points[points.length - 1].b) + (Math.abs(y(points[points.length - 1].a) - y(points[points.length - 1].b)) < 12 ? 14 : 3)} fontSize={10.5} fontWeight={700} fill="var(--series-against)" fontFamily="var(--font-ui)">
              {bLabel}
            </text>
          </>
        )}

        {/* x ticks */}
        {points.map((p, i) =>
          i % step === 0 ? (
            <text key={i} x={x(i)} y={H - 8} fontSize={10} fill="var(--muted)" textAnchor={tickAnchor(i, points.length)} fontFamily="var(--font-mono)">
              {p.label}
            </text>
          ) : null
        )}

        {/* crosshair + markers */}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--hair-strong)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(points[hover].a)} r={4} fill="var(--series-for)" stroke="var(--card)" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(points[hover].b)} r={4} fill="var(--series-against)" stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>

      {hp && hover !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            top: 0,
            transform: `translate(${hover > points.length / 2 ? "calc(-100% - 12px)" : "12px"}, 0)`,
          }}
        >
          <div className="tt-title">{hp.title}</div>
          <div className="tt-row">
            <span className="tt-swatch" style={{ background: "var(--series-for)" }} />
            {aLabel} <span className="tt-val">{hp.a}</span>
          </div>
          <div className="tt-row">
            <span className="tt-swatch" style={{ background: "var(--series-against)" }} />
            {bLabel} <span className="tt-val">{hp.b}</span>
          </div>
        </div>
      )}

      <div className="legend" style={{ marginTop: 8 }}>
        <span className="l-item"><span className="l-swatch" style={{ background: "var(--series-for)" }} /> {aLabel}</span>
        <span className="l-item">
          <svg width="16" height="4" style={{ display: "block" }} aria-hidden="true"><line x1="0" y1="2" x2="16" y2="2" stroke="var(--series-against)" strokeWidth="2.4" strokeDasharray="4 3" /></svg>
          {bLabel}
        </span>
      </div>
    </div>
  );
}
