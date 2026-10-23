"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  type UTCTimestamp,
} from "lightweight-charts";

interface Point {
  time: number;
  equity: number;
}

export default function EquityChart({ points, height = 260 }: { points: Point[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0d1420" },
        textColor: "#8fa3bd",
      },
      grid: {
        vertLines: { color: "rgba(30,42,63,0.5)" },
        horzLines: { color: "rgba(30,42,63,0.5)" },
      },
      rightPriceScale: { borderColor: "#1e2a3f" },
      timeScale: { borderColor: "#1e2a3f" },
      height,
      autoSize: true,
    });
    const up = points[points.length - 1].equity >= points[0].equity;
    const area = chart.addAreaSeries({
      lineColor: up ? "#16c784" : "#ea3943",
      topColor: up ? "rgba(22,199,132,0.35)" : "rgba(234,57,67,0.35)",
      bottomColor: "rgba(13,20,32,0.05)",
      lineWidth: 2,
    });
    // dedupe timestamps (final close-out can repeat the last time)
    const seen = new Map<number, number>();
    for (const p of points) seen.set(p.time, p.equity);
    area.setData(
      [...seen.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, value]) => ({ time: time as UTCTimestamp, value }))
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, height]);

  if (points.length === 0)
    return <div className="muted text-sm py-6 text-center">No equity data.</div>;
  return <div ref={ref} className="w-full" />;
}
