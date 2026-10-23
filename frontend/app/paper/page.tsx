"use client";

import { useCallback, useEffect, useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";
import { api, fmt, timeLabel, type Strategy } from "@/lib/api";

export default function PaperTrading() {
  const ready = useRequireAuth();
  const [data, setData] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  const [qty, setQty] = useState(10);
  const [orderType, setOrderType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [runStrategyId, setRunStrategyId] = useState<number | "">("");
  const [runSymbol, setRunSymbol] = useState("");

  const load = useCallback(async () => {
    const acc = await api("/api/paper/account");
    setData(acc);
    const o = await api("/api/paper/orders");
    setOrders(o.orders);
  }, []);

  useEffect(() => {
    if (!ready) return;
    load().catch((e) => setErr(e.message));
    api("/api/strategies").then((d) => {
      setStrategies(d.strategies);
      if (d.strategies.length) setRunStrategyId(d.strategies[0].id);
    }).catch(() => {});
  }, [ready, load]);

  async function place(side: "buy" | "sell") {
    setErr(""); setMsg("");
    try {
      const body: any = { symbol, side, qty, order_type: orderType };
      if (orderType === "limit") body.limit_price = Number(limitPrice);
      const r = await api("/api/paper/orders", { method: "POST", body: JSON.stringify(body) });
      setMsg(`Simulated ${side} filled: ${r.order.qty} × ${r.order.symbol} at ${fmt(r.order.price)} (${r.order.data_source} data). Cash now ${fmt(r.cash)}.`);
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function runAlgo() {
    if (!runStrategyId) return;
    setErr(""); setMsg("");
    try {
      const r = await api("/api/paper/run-strategy", {
        method: "POST",
        body: JSON.stringify({ strategy_id: runStrategyId, symbol: runSymbol || null }),
      });
      setMsg(r.message);
      load();
    } catch (e: any) { setErr(e.message); }
  }

  if (!ready) return null;
  const a = data?.account;
  const positions = data?.positions || [];

  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-1">Paper Trading</h1>
      <p className="muted text-sm mb-5">
        Simulated trading with virtual money. Orders never reach a real broker.
        Fills use the latest available price with 0.05% adverse slippage; limit orders are immediate-or-cancel against the current simulated price.
      </p>
      {msg && <p className="pos text-sm mb-3">{msg}</p>}
      {err && <p className="neg text-sm mb-3">{err}</p>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card"><div className="muted text-xs">Equity ({a?.currency || "INR"})</div>
          <div className="text-2xl font-extrabold mt-1">{a ? fmt(a.equity) : "…"}</div></div>
        <div className="card"><div className="muted text-xs">Cash</div>
          <div className="text-2xl font-extrabold mt-1">{a ? fmt(a.cash) : "…"}</div></div>
        <div className="card"><div className="muted text-xs">Positions value</div>
          <div className="text-2xl font-extrabold mt-1">{a ? fmt(a.market_value) : "…"}</div></div>
        <div className="card"><div className="muted text-xs">Total P&amp;L (started {a ? fmt(a.starting_balance, 0) : ""})</div>
          <div className={`text-2xl font-extrabold mt-1 ${a && a.total_pnl >= 0 ? "pos" : "neg"}`}>{a ? fmt(a.total_pnl) : "…"}</div></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="card">
          <h2 className="font-bold mb-3">Place a simulated order</h2>
          <label className="label">Symbol</label>
          <input className="input mb-3" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="label">Quantity</label>
              <input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Order type</label>
              <select className="select" value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </select>
            </div>
          </div>
          {orderType === "limit" && (
            <>
              <label className="label">Limit price</label>
              <input className="input mb-3" type="number" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} />
            </>
          )}
          <div className="flex gap-2">
            <button className="btn green" onClick={() => place("buy")}>Buy (simulated)</button>
            <button className="btn red" onClick={() => place("sell")}>Sell (simulated)</button>
          </div>

          <h3 className="font-bold mt-6 mb-2">Run an algorithm on this account</h3>
          <p className="muted text-xs mb-2">
            Reads the strategy's latest signal (default symbol: its last backtest symbol, else RELIANCE.NS)
            and places the matching simulated order if the account is not already positioned that way.
          </p>
          <div className="flex gap-2 flex-wrap">
            <select className="select" style={{ maxWidth: 260 }} value={runStrategyId}
                    onChange={(e) => setRunStrategyId(Number(e.target.value))}>
              {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input className="input" style={{ maxWidth: 160 }} placeholder="Symbol (optional)"
                   value={runSymbol} onChange={(e) => setRunSymbol(e.target.value.toUpperCase())} />
            <button className="btn" onClick={runAlgo}>Run strategy once</button>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <h2 className="font-bold mb-3">Open positions</h2>
          {positions.length === 0 && <p className="muted text-sm">No open positions.</p>}
          {positions.length > 0 && (
            <table className="table min-w-[520px]">
              <thead><tr><th>Symbol</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Unrealised P&amp;L</th><th>Data</th></tr></thead>
              <tbody>
                {positions.map((p: any) => (
                  <tr key={p.symbol}>
                    <td className="font-semibold">{p.symbol}</td>
                    <td>{p.qty}</td>
                    <td>{fmt(p.avg_cost)}</td>
                    <td>{fmt(p.current_price)}</td>
                    <td className={p.unrealised_pnl >= 0 ? "pos" : "neg"}>{fmt(p.unrealised_pnl)}</td>
                    <td><span className={`chip ${p.source === "live" ? "live" : "sample"}`}>{p.source === "live" ? "Delayed" : "SAMPLE"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card mt-6 overflow-x-auto">
        <h2 className="font-bold mb-3">Trade history</h2>
        {orders.length === 0 && <p className="muted text-sm">No simulated trades yet.</p>}
        {orders.length > 0 && (
          <table className="table min-w-[680px]">
            <thead><tr><th>When</th><th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Fill price</th><th>Realised P&amp;L</th><th>Note</th></tr></thead>
            <tbody>
              {orders.map((o: any) => (
                <tr key={o.id}>
                  <td className="muted">{o.created_at ? new Date(o.created_at + "Z").toLocaleString("en-IN") : ""}</td>
                  <td className="font-semibold">{o.symbol}</td>
                  <td className={o.side === "buy" ? "pos" : "neg"}>{o.side.toUpperCase()}</td>
                  <td>{o.order_type}</td>
                  <td>{o.qty}</td>
                  <td>{fmt(o.price)}</td>
                  <td className={o.realised_pnl >= 0 ? "pos" : "neg"}>{o.side === "sell" ? fmt(o.realised_pnl) : "—"}</td>
                  <td className="muted text-xs">{o.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted text-xs mt-3">All trades on this page are simulated. Virtual P&amp;L is not real money and proves nothing about future results.</p>
      </div>
    </Shell>
  );
}
