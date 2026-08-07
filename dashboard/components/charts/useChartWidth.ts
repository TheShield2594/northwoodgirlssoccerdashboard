"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Measures the chart's container so the SVG can use a viewBox whose units
 * are CSS pixels (1 unit = 1px). Without this a fixed 720-wide viewBox
 * scaled into a ~300px phone card shrinks every label with it — a 10px
 * axis tick renders at ~4px and the chart becomes decoration.
 *
 * SSR and the first client render both use `fallback`, so hydration
 * matches; the real width lands in the effect right after mount.
 */
export function useChartWidth(fallback = 720) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = (w: number) => {
      if (w > 0) setWidth(Math.round(w));
    };
    measure(el.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      measure(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width: width ?? fallback };
}

/**
 * How many x-axis labels fit without colliding, given the plot width and
 * roughly how wide one label is. Returns the stride to step by.
 */
export function labelStride(count: number, innerW: number, labelPx = 42) {
  const fits = Math.max(2, Math.floor(innerW / labelPx));
  return Math.max(1, Math.ceil(count / fits));
}

/**
 * Axis bounds on round numbers.
 *
 * Halving the data max gave domains like 0 / 26 / 52 and — worse — 0 / 4 / 7,
 * where the steps are unequal but the gridlines are drawn at proportional
 * positions. The result reads as a linear axis with mis-spaced rules.
 *
 * `minStep` is 1 because every axis in this dashboard counts whole things
 * (goals, wins, games); without it a two-goal season would be ruled at
 * half-goal intervals.
 */
export function niceScale(rawMax: number, targetSteps = 4, minStep = 1) {
  const safe = Math.max(rawMax, minStep);
  const rough = safe / targetSteps;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const nice = ([1, 2, 2.5, 5, 10].find((s) => s * mag >= rough) ?? 10) * mag;
  const step = Math.max(minStep, nice);
  const max = Math.ceil(safe / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 1000; v += step) ticks.push(Math.round(v * 100) / 100);
  return { max, step, ticks };
}

/**
 * `text-anchor` for an x-axis tick. The first and last labels are centred on
 * points that sit exactly on the plot edges, so on a phone — where the right
 * padding drops to a few px — the final label overflowed the SVG and was
 * clipped mid-string. Anchoring the ends inward keeps them on canvas.
 */
export function tickAnchor(i: number, count: number): "start" | "middle" | "end" {
  // A lone point is drawn at the centre of the plot, not on either edge, so
  // it has no edge to be anchored away from.
  if (count === 1) return "middle";
  if (i === 0) return "start";
  if (i === count - 1) return "end";
  return "middle";
}
