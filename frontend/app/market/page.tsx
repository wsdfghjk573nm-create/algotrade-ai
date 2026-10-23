"use client";

import { useCallback, useEffect, useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";
import CandleChart from "@/components/CandleChart";
import { api, fmt, fmtPct, type Bar } from "@/lib/api";

const RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "5y"];

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 96},${30 - ((v - min) / span) * 26 - 2}`)
    .join(" ");
  return (
    <svg width="96" height="32" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "#16c784" : "#ea3943"} strokeWidth="1.6" />
    </svg>
  );
}

export default function MarketWatch() {
  const ready = useRequireAuth();
  const [symbols, setSymbols] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [selected, setSelected] = useState("AAPL");
  const [custom, setCustom] = useState("");
  const [range, setRange] = useState("6mo");
  const [bars, setBars] = useState<Bar[]>([]);
  const [indicators, setIndicators] = useState<any>(null);
  const [source, setSource] = useState("");
  const [showSma, setShowSma] = useState(true);
  const [showBb, setShowBb] = useState(false);

  const loadChart = useCallback(async (sym: string, rng: string) => {
    const d = await api(`/api/market/indicators?symbol=${encodeURIComponent(sym)}&range=${rng}`);
    setBars(d.bars);
    setIndicators(d.indicators);
    setSource(d.source);
  }, []);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const s = await api("/api/market/symbols");
      setSymbols(s.symbols);
      const syms = s.symbols.map((x: any) => x.symbol).join(",");
      const q = await api(`/api/market/quotes?symbols=${encodeURIComponent(syms)}`);
      setQuotes(q.quotes);
    })();
    loadChart(selected, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (ready) loadChart(selected, range);
  }, [selected, range, ready, loadChart]);

  const lines: any[] = [];
  if (indicators && showSma) {
    lines.push({ name: "SMA 20", color: "#4f8ff7", values: indicators.sma20 });
    lines.push({ name: "SMA 50", color: "#f59e0b", values: indicators.sma50 });
  }
  if (indicators && showBb) {
    lines.push({ name: "BB Upper", color: "#64748b", values: indicators.bb_upper });
    lines.push({ name: "BB Lower", color: "#64748b", values: indicators.bb_lower });
  }
  const selQuote = quotes.find((q) => q.symbol === selected);
  const lastRsi = indicators?.rsi14?.filter((v: any) => v !== null).slice(-1)[0];
  const lastMacd = indicators?.macd?.filter((v: any) => v !== null).slice(-1)[0];

  if (!ready) return null;
  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-1">Market Watch</h1>
      <p className="muted text-sm mb-5">
        Delayed data (Yahoo Finance, unofficial) when available; otherwise clearly-labelled SAMPLE data.
      </p>

      <div className="card mb-6 overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead>
            <tr><th>Symbol</th><th>Price</th><th>Change</th><th>Trend</th><th>Data</th></tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.symbol} className="cursor-pointer hover:bg-[#111a2b]"
                  onClick={() => setSelected(q.symbol)}>
                <td className="font-semibold">
                  {q.symbol}
                  <div className="muted text-xs font-normal">
                    {symbols.find((s) => s.symbol === q.symbol)?.name || ""}
                  </div>
                </td>
                <td>{fmt(q.price)}</td>
                <td className={q.change >= 0 ? "pos" : "neg"}>{fmtPct(q.change_pct)}</td>
                <td><Spark values={q.spark || []} up={q.change >= 0} /></td>
                <td><span className={`chip ${q.source === "live" ? "live" : "sample"}`}>{q.source === "live" ? "Delayed" : "SAMPLE"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input className="input" style={{ maxWidth: 200 }} value={custom}
                 placeholder="Any symbol e.g. SBIN.NS"
                 onChange={(e) => setCustom(e.target.value.toUpperCase())}
                 onKeyDown={(e) => { if (e.key === "Enter" && custom) setSelected(custom); }} />
          <button className="btn" onClick={() => custom && setSelected(custom)}>Load</button>
          <span className="font-bold text-lg ml-2">{selected}</span>
          {selQuote && <span className={selQuote.change >= 0 ? "pos" : "neg"}>{fmt(selQuote.price)} ({fmtPct(selQuote.change_pct)})</span>}
          <span className={`chip ${source === "live" ? "live" : "sample"}`}>{source === "live" ? "Delayed data" : "SAMPLE data"}</span>
          <div className="flex gap-1 flex-wrap ml-auto">
            {RANGES.map((r) => (
              <button key={r} className={`btn small ${range === r ? "primary" : ""}`} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-4 text-sm mb-2">
          <label><input type="checkbox" checked={showSma} onChange={(e) => setShowSma(e.target.checked)} /> SMA 20/50 overlays</label>
          <label><input type="checkbox" checked={showBb} onChange={(e) => setShowBb(e.target.checked)} /> Bollinger Bands</label>
          {lastRsi !== undefined && <span className="muted">RSI(14): <b className="text-[#e6edf6]">{fmt(lastRsi, 1)}</b></span>}
          {lastMacd !== undefined && <span className="muted">MACD: <b className="text-[#e6edf6]">{fmt(lastMacd)}</b></span>}
        </div>
        <CandleChart bars={bars} smaSeries={lines} />
        <p className="muted text-xs mt-2">
          {source === "live"
            ? "Delayed market data — Yahoo Finance (unofficial). Not investment advice."
            : "SAMPLE data — simulated for education, not real prices."}
        </p>
      </div>
    </Shell>
  );
}
