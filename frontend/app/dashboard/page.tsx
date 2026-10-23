"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";
import CandleChart from "@/components/CandleChart";
import { api, fmt, fmtPct, type Bar } from "@/lib/api";

const RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "5y"];

export default function Dashboard() {
  const ready = useRequireAuth();
  const [account, setAccount] = useState<any>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  const [range, setRange] = useState("6mo");
  const [bars, setBars] = useState<Bar[]>([]);
  const [source, setSource] = useState("");
  const [smaLines, setSmaLines] = useState<any[]>([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [runs, setRuns] = useState<any[]>([]);
  const [error, setError] = useState("");

  const loadChart = useCallback(async (sym: string, rng: string) => {
    try {
      const d = await api(`/api/market/indicators?symbol=${encodeURIComponent(sym)}&range=${rng}`);
      setBars(d.bars);
      setSource(d.source);
      setSmaLines([
        { name: "SMA 50", color: "#f59e0b", values: d.indicators.sma50 },
        { name: "SMA 200", color: "#a78bfa", values: d.indicators.sma200 },
      ]);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadQuotes = useCallback(async (symbols: string[]) => {
    if (!symbols.length) return;
    try {
      const d = await api(`/api/market/quotes?symbols=${symbols.map(encodeURIComponent).join(",")}`);
      const map: Record<string, any> = {};
      for (const q of d.quotes) map[q.symbol] = q;
      setQuotes(map);
    } catch {}
  }, []);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const acc = await api("/api/paper/account");
        setAccount(acc.account);
        const wl = await api("/api/watchlist");
        const list = wl.watchlist.length ? wl.watchlist : ["RELIANCE.NS", "AAPL", "BTC-USD"];
        setWatchlist(wl.watchlist);
        loadQuotes(list);
        const bt = await api("/api/backtests");
        setRuns(bt.backtests.slice(0, 5));
      } catch (e: any) {
        setError(e.message);
      }
    })();
    loadChart(symbol, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (ready) loadChart(symbol, range);
  }, [symbol, range, ready, loadChart]);

  async function addSymbol() {
    const s = newSymbol.trim().toUpperCase();
    if (!s) return;
    await api("/api/watchlist", { method: "POST", body: JSON.stringify({ symbol: s }) });
    const list = [...watchlist, s];
    setWatchlist(list);
    setNewSymbol("");
    loadQuotes(list);
  }

  async function removeSymbol(s: string) {
    await api(`/api/watchlist/${encodeURIComponent(s)}`, { method: "DELETE" });
    setWatchlist(watchlist.filter((x) => x !== s));
  }

  if (!ready) return null;
  const a = account;

  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-1">Dashboard</h1>
      <p className="muted text-sm mb-5">Your paper-trading overview. All money here is virtual.</p>
      {error && <p className="neg text-sm mb-3">{error}</p>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <div className="muted text-xs">Virtual equity ({a?.currency || "INR"})</div>
          <div className="text-2xl font-extrabold mt-1">{a ? fmt(a.equity) : "…"}</div>
        </div>
        <div className="card">
          <div className="muted text-xs">Cash available</div>
          <div className="text-2xl font-extrabold mt-1">{a ? fmt(a.cash) : "…"}</div>
        </div>
        <div className="card">
          <div className="muted text-xs">Total paper P&amp;L</div>
          <div className={`text-2xl font-extrabold mt-1 ${a && a.total_pnl >= 0 ? "pos" : "neg"}`}>
            {a ? `${a.total_pnl >= 0 ? "+" : ""}${fmt(a.total_pnl)}` : "…"}
          </div>
        </div>
        <div className="card">
          <div className="muted text-xs">Realised P&amp;L</div>
          <div className={`text-2xl font-extrabold mt-1 ${a && a.realised_pnl >= 0 ? "pos" : "neg"}`}>
            {a ? `${a.realised_pnl >= 0 ? "+" : ""}${fmt(a.realised_pnl)}` : "…"}
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input className="input" style={{ maxWidth: 220 }} value={symbol}
                 onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                 placeholder="Symbol e.g. TCS.NS, AAPL, BTC-USD" />
          <div className="flex gap-1 flex-wrap">
            {RANGES.map((r) => (
              <button key={r} className={`btn small ${range === r ? "primary" : ""}`}
                      onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
          {source && (
            <span className={`chip ${source === "live" ? "live" : "sample"}`}>
              {source === "live" ? "Delayed data" : "SAMPLE data"}
            </span>
          )}
        </div>
        <CandleChart bars={bars} smaSeries={smaLines} />
        <p className="muted text-xs mt-2">
          {source === "live"
            ? "Delayed market data — Yahoo Finance (unofficial)."
            : "SAMPLE data — simulated for education, not real prices."}{" "}
          Orange = SMA 50, Purple = SMA 200.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-bold mb-3">Watchlist</h2>
          <div className="flex gap-2 mb-3">
            <input className="input" placeholder="Add symbol e.g. INFY.NS" value={newSymbol}
                   onChange={(e) => setNewSymbol(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && addSymbol()} />
            <button className="btn" onClick={addSymbol}>Add</button>
          </div>
          {watchlist.length === 0 && <p className="muted text-sm">Your watchlist is empty — add a symbol above.</p>}
          <table className="table">
            <tbody>
              {watchlist.map((s) => {
                const q = quotes[s];
                return (
                  <tr key={s}>
                    <td>
                      <button className="text-[#4f8ff7] font-semibold" onClick={() => setSymbol(s)}>{s}</button>{" "}
                      {q && <span className={`chip ${q.source === "live" ? "live" : "sample"}`}>{q.source === "live" ? "Delayed" : "SAMPLE"}</span>}
                    </td>
                    <td>{q ? fmt(q.price) : "…"}</td>
                    <td className={q && q.change >= 0 ? "pos" : "neg"}>{q ? fmtPct(q.change_pct) : ""}</td>
                    <td><button className="btn small" onClick={() => removeSymbol(s)}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="font-bold mb-3">Recent backtests</h2>
          {runs.length === 0 && (
            <p className="muted text-sm">
              No backtests yet. <Link href="/backtest" className="text-[#4f8ff7]">Run your first backtest →</Link>
            </p>
          )}
          <table className="table">
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.strategy_name}<div className="muted text-xs">{r.symbol} · {r.range} · {r.data_source}</div></td>
                  <td className={r.metrics.total_return_pct >= 0 ? "pos" : "neg"}>{fmtPct(r.metrics.total_return_pct)}</td>
                  <td className="muted text-xs">{r.metrics.num_trades} trades</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2 mt-4">
            <Link className="btn small" href="/builder">Build a strategy</Link>
            <Link className="btn small" href="/paper">Paper trading</Link>
          </div>
        </div>
      </div>
    </Shell>
  );
}
