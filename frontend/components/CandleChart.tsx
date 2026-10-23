"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar } from "@/lib/api";

interface Props {
  bars: Bar[];
  smaSeries?: { name: string; color: string; values: (number | null)[] }[];
  height?: number;
}

export default function CandleChart({ bars, smaSeries = [], height = 380 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || bars.length === 0) return;
    const chart: IChartApi = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0d1420" },
        textColor: "#8fa3bd",
      },
      grid: {
        vertLines: { color: "rgba(30,42,63,0.5)" },
        horzLines: { color: "rgba(30,42,63,0.5)" },
      },
      rightPriceScale: { borderColor: "#1e2a3f" },
      timeScale: { borderColor: "#1e2a3f", timeVisible: true },
      height,
      autoSize: true,
    });
    const candles = chart.addCandlestickSeries({
      upColor: "#16c784",
      downColor: "#ea3943",
      borderVisible: false,
      wickUpColor: "#16c784",
      wickDownColor: "#ea3943",
    });
    candles.setData(
      bars.map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
    );
    const volume = chart.addHistogramSeries({
      priceScaleId: "",
      priceFormat: { type: "volume" },
    });
    chart.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(
      bars.map((b) => ({
        time: b.time as UTCTimestamp,
        value: b.volume,
        color: b.close >= b.open ? "rgba(22,199,132,0.45)" : "rgba(234,57,67,0.45)",
      }))
    );
    for (const s of smaSeries) {
      const line = chart.addLineSeries({
        color: s.color,
        lineWidth: 1,
        priceLineVisible: false,
        title: s.name,
      });
      line.setData(
        bars
          .map((b, i) => ({ time: b.time as UTCTimestamp, value: s.values[i] }))
          .filter((p) => p.value !== null && p.value !== undefined) as any
      );
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, smaSeries, height]);

  if (bars.length === 0)
    return <div className="muted text-sm py-8 text-center">No chart data.</div>;
  return <div ref={ref} className="w-full" />;
}
