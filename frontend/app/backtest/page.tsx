"use client";

import { useEffect, useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";
import EquityChart from "@/components/EquityChart";
import { api, fmt, fmtPct, timeLabel, type Strategy } from "@/lib/api";

const RANGES = ["1mo", "3mo", "6mo", "1y", "5y"];

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <div className="muted text-xs">{label}</div>
      <div className={`text-xl font-extrabold mt-1 ${tone || ""}`}>{value}</div>
    </div>
  );
}

export default function BacktestPage() {
  const ready = useRequireAuth();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategyId, setStrategyId] = useState<number | "">("");
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  const [range, setRange] = useState("1y");
  const [capital, setCapital] = useState(100000);
  const [run, setRun] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [review, setReview] = useState("");

  async function loadHistory() {
    const d = await api("/api/backtests");
    setHistory(d.backtests);
  }
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const d = await api("/api/strategies");
      setStrategies(d.strategies);
      if (d.strategies.length) setStrategyId(d.strategies[0].id);
      loadHistory();
    })().catch((e) => setErr(e.message));
  }, [ready]);

  async function runBacktest() {
    if (!strategyId) return;
    setBusy(true); setErr(""); setReview("");
    try {
      const r = await api("/api/backtests/run", {
        method: "POST",
        body: JSON.stringify({ strategy_id: strategyId, symbol, range, initial_capital: capital }),
      });
      setRun(r);
      loadHistory();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function reviewRun(id: number) {
    setReview("Reviewing…");
    try {
      const r = await api("/api/assistant/review", {
        method: "POST", body: JSON.stringify({ backtest_id: id }),
      });
      setReview(r.reply);
    } catch (e: any) { setReview(e.message); }
  }

  async function openRun(id: number) {
    const r = await api(`/api/backtests/${id}`);
    setRun(r); setReview("");
  }

  if (!ready) return null;
  const m = run?.metrics;

  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-1">Backtesting</h1>
      <p className="muted text-sm mb-5">
        Signals execute at the <b>next bar's open</b> — no look-ahead bias. Commissions and slippage
        from your strategy settings are charged on every fill. Past performance does not guarantee future results.
      </p>
      {err && <p className="neg text-sm mb-3">{err}</p>}

      <div className="card mb-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className="label">Strategy</label>
            <select className="select" value={strategyId} onChange={(e) => setStrategyId(Number(e.target.value))}>
              {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Symbol</label>
            <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="label">Range</label>
            <select className="select" value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Starting capital</label>
            <input className="input" type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
          </div>
          <button className="btn primary justify-center" onClick={runBacktest} disabled={busy || !strategyId}>
            {busy ? "Running…" : "Run backtest"}
          </button>
        </div>
      </div>

      {run && m && (
        <div className="rise">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h2 className="font-bold">{run.strategy_name} on {run.symbol} ({run.range})</h2>
            <span className={`chip ${run.data_source === "live" ? "live" : "sample"}`}>
              {run.data_source === "live" ? "Delayed data" : "SAMPLE data"}
            </span>
            <button className="btn small ml-auto" onClick={() => reviewRun(run.id)}>🤖 Review with assistant</button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Metric label="Total return" value={fmtPct(m.total_return_pct)} tone={m.total_return_pct >= 0 ? "pos" : "neg"} />
            <Metric label="Benchmark (buy & hold)" value={fmtPct(m.benchmark_return_pct)} />
            <Metric label="Alpha vs benchmark" value={fmtPct(m.alpha_pct)} tone={m.alpha_pct >= 0 ? "pos" : "neg"} />
            <Metric label="Max drawdown" value={`${fmt(m.max_drawdown_pct)}%`} tone="neg" />
            <Metric label="Win rate" value={`${fmt(m.win_rate_pct)}%`} />
            <Metric label="Trades" value={String(m.num_trades)} />
            <Metric label="Profit factor" value={m.profit_factor === null ? "—" : fmt(m.profit_factor, 3)} />
            <Metric label="Sharpe (approx, 0% rf)" value={m.sharpe === null ? "—" : fmt(m.sharpe, 3)} />
            <Metric label="Avg win" value={fmt(m.avg_win)} tone="pos" />
            <Metric label="Avg loss" value={fmt(m.avg_loss)} tone="neg" />
            <Metric label="Expectancy / trade" value={fmt(m.expectancy)} tone={m.expectancy >= 0 ? "pos" : "neg"} />
            <Metric label="CAGR" value={m.cagr_pct === null ? "—" : fmtPct(m.cagr_pct)} />
          </div>

          <div className="card mb-4">
            <h3 className="font-bold mb-2">Equity curve</h3>
            <EquityChart points={run.equity_curve} />
          </div>

          {review && (
            <div className="card mb-4 whitespace-pre-line text-sm leading-relaxed">
              <h3 className="font-bold mb-2">🤖 Assistant review</h3>
              {review}
            </div>
          )}

          <div className="card overflow-x-auto">
            <h3 className="font-bold mb-2">Trades ({run.trades.length})</h3>
            {run.trades.length === 0 && <p className="muted text-sm">This strategy took no trades in this period.</p>}
            {run.trades.length > 0 && (
              <table className="table min-w-[720px]">
                <thead>
                  <tr><th>#</th><th>Side</th><th>Entry</th><th>Entry price</th><th>Exit</th><th>Exit price</th><th>Qty</th><th>P&amp;L</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {run.trades.map((t: any, i: number) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{t.direction}</td>
                      <td>{timeLabel(t.entry_time)}</td>
                      <td>{fmt(t.entry_price)}</td>
                      <td>{timeLabel(t.exit_time)}</td>
                      <td>{fmt(t.exit_price)}</td>
                      <td>{t.qty}</td>
                      <td className={t.pnl >= 0 ? "pos" : "neg"}>{fmt(t.pnl)}</td>
                      <td className="muted">{t.exit_reason.replace(/_/g, " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted text-xs mt-3">{m.disclaimer}</p>
          </div>
        </div>
      )}

      <div className="card mt-6">
        <h2 className="font-bold mb-3">Previous runs</h2>
        {history.length === 0 && <p className="muted text-sm">No backtests yet.</p>}
        <div className="flex flex-col gap-1">
          {history.map((r) => (
            <button key={r.id} className="text-left px-3 py-2 rounded-lg hover:bg-[#111a2b]" onClick={() => openRun(r.id)}>
              <span className="font-semibold">{r.strategy_name}</span>{" "}
              <span className="muted text-sm">{r.symbol} · {r.range} · {r.data_source} · </span>
              <span className={r.metrics.total_return_pct >= 0 ? "pos" : "neg"}>{fmtPct(r.metrics.total_return_pct)}</span>
              <span className="muted text-sm"> · DD {fmt(r.metrics.max_drawdown_pct)}% · {r.metrics.num_trades} trades</span>
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}
