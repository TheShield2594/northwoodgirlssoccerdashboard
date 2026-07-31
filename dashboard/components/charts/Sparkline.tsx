/** Tiny inline trend (server-renderable, no hover). */
export default function Sparkline({
  values,
  width = 110,
  height = 30,
  color = "var(--red)",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const pad = 3;
  const x = (i: number) =>
    pad + (values.length === 1 ? (width - 2 * pad) / 2 : (i / (values.length - 1)) * (width - 2 * pad));
  const y = (v: number) => height - pad - (v / max) * (height - 2 * pad);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.6} fill={color} />
    </svg>
  );
}
