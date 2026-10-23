"use client";

import { useEffect, useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";
import { api, fmtPct, type Strategy } from "@/lib/api";

function Stars({ value, onRate }: { value: number; onRate?: (n: number) => void }) {
  return (
    <span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} disabled={!onRate} onClick={() => onRate && onRate(n)}
                className="text-lg" style={{ color: n <= value ? "#f59e0b" : "#475569" }}
                aria-label={`${n} stars`}>★</button>
      ))}
    </span>
  );
}

export default function Marketplace() {
  const ready = useRequireAuth();
  const [items, setItems] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [publishId, setPublishId] = useState<number | "">("");
  const [reviewText, setReviewText] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    const d = await api("/api/marketplace");
    setItems(d.published);
    const s = await api("/api/strategies");
    setStrategies(s.strategies);
    if (s.strategies.length && !publishId) setPublishId(s.strategies[0].id);
  }
  useEffect(() => { if (ready) load().catch((e) => setErr(e.message)); }, [ready]);

  async function publish() {
    if (!publishId) return;
    setErr(""); setMsg("");
    try {
      const p = await api("/api/marketplace/publish", {
        method: "POST", body: JSON.stringify({ strategy_id: publishId }),
      });
      setMsg(`Published "${p.title}". Its stats are labelled user-submitted.`);
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function rate(id: number, stars: number) {
    const u = await api(`/api/marketplace/${id}/rate`, {
      method: "POST",
      body: JSON.stringify({ stars, review: reviewText[id] || "" }),
    });
    setItems((prev) => prev.map((p) => (p.id === id ? u : p)));
  }

  async function clone(id: number, title: string) {
    const s = await api(`/api/marketplace/${id}/clone`, { method: "POST" });
    setMsg(`Cloned "${title}" into your strategies as "${s.name}".`);
    load();
  }

  if (!ready) return null;
  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-1">Strategy Marketplace</h1>
      <p className="muted text-sm mb-5">
        Community strategies with their backtest statistics. <b>Important:</b> user-submitted
        statistics are <b>not independently verified</b> — a good-looking backtest is not evidence
        of future profits. Official examples are labelled as examples with illustrative stats.
      </p>
      {msg && <p className="pos text-sm mb-3">{msg}</p>}
      {err && <p className="neg text-sm mb-3">{err}</p>}

      <div className="card mb-6 flex flex-wrap gap-2 items-center">
        <span className="font-semibold">Publish one of my strategies:</span>
        <select className="select" style={{ maxWidth: 280 }} value={publishId}
                onChange={(e) => setPublishId(Number(e.target.value))}>
          {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn primary" onClick={publish} disabled={!publishId}>Publish</button>
        <span className="muted text-xs">Your latest backtest stats for that strategy are attached automatically.</span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {items.map((p) => (
          <div key={p.id} className="card rise">
            <div className="flex items-start gap-2">
              <h3 className="font-bold flex-1">{p.title}</h3>
              {p.is_official_example
                ? <span className="chip live">Example</span>
                : <span className="chip sample">User-submitted</span>}
            </div>
            <p className="muted text-xs">by {p.publisher} · {p.kind}</p>
            <p className="text-sm mt-2 leading-relaxed">{p.description}</p>
            {p.stats && Object.keys(p.stats).length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div><div className="muted text-[11px]">Return</div>
                  <b className={p.stats.total_return_pct >= 0 ? "pos" : "neg"}>{p.stats.total_return_pct == null ? "—" : fmtPct(p.stats.total_return_pct)}</b></div>
                <div><div className="muted text-[11px]">Max DD</div><b>{p.stats.max_drawdown_pct ?? "—"}%</b></div>
                <div><div className="muted text-[11px]">Win rate</div><b>{p.stats.win_rate_pct ?? "—"}%</b></div>
                <div><div className="muted text-[11px]">Trades</div><b>{p.stats.num_trades ?? "—"}</b></div>
                <div><div className="muted text-[11px]">On</div><b>{p.stats.symbol || "—"}</b></div>
                <div><div className="muted text-[11px]">Range</div><b>{p.stats.range || "—"}</b></div>
              </div>
            )}
            <p className="text-[11px] mt-2" style={{ color: "#fbbf24" }}>⚠ {p.stats_label}</p>
            <div className="flex items-center gap-2 mt-3">
              <Stars value={Math.round(p.avg_rating || 0)} />
              <span className="muted text-xs">
                {p.avg_rating ? `${p.avg_rating} avg · ` : ""}{p.num_ratings} rating{p.num_ratings === 1 ? "" : "s"}
              </span>
              <button className="btn small ml-auto" onClick={() => clone(p.id, p.title)}>Clone to my strategies</button>
            </div>
            <div className="flex gap-2 mt-3">
              <input className="input" placeholder="Short review (optional)"
                     value={reviewText[p.id] || ""}
                     onChange={(e) => setReviewText({ ...reviewText, [p.id]: e.target.value })} />
              <span className="flex items-center gap-1">
                <span className="muted text-xs">Rate:</span>
                <Stars value={0} onRate={(n) => rate(p.id, n)} />
              </span>
            </div>
            {p.reviews?.length > 0 && (
              <div className="mt-3 space-y-1">
                {p.reviews.filter((r: any) => r.review).slice(0, 3).map((r: any, i: number) => (
                  <p key={i} className="text-xs muted">{"★".repeat(r.stars)} — “{r.review}”</p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {items.length === 0 && <p className="muted">No published strategies yet.</p>}
    </Shell>
  );
}
