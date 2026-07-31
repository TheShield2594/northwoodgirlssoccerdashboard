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
