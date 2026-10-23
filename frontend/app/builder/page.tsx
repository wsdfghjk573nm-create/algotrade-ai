"use client";

import { useEffect, useRef, useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";
import { api, type Strategy } from "@/lib/api";

const OPERATORS = ["crosses_above", "crosses_below", ">", "<", ">=", "<="];
const INDICATORS = [
  { name: "sma", label: "SMA (period)", params: ["period"] },
  { name: "ema", label: "EMA (period)", params: ["period"] },
  { name: "rsi", label: "RSI (period)", params: ["period"] },
  { name: "macd", label: "MACD line", params: ["fast", "slow", "signal"] },
  { name: "macd_signal", label: "MACD signal line", params: ["fast", "slow", "signal"] },
  { name: "macd_hist", label: "MACD histogram", params: ["fast", "slow", "signal"] },
  { name: "bb_upper", label: "Bollinger upper", params: ["period"] },
  { name: "bb_mid", label: "Bollinger middle", params: ["period"] },
  { name: "bb_lower", label: "Bollinger lower", params: ["period"] },
];
const DEFAULT_PARAMS: Record<string, any> = {
  sma: { period: 50 }, ema: { period: 20 }, rsi: { period: 14 },
  macd: { fast: 12, slow: 26, signal: 9 }, macd_signal: { fast: 12, slow: 26, signal: 9 },
  macd_hist: { fast: 12, slow: 26, signal: 9 },
  bb_upper: { period: 20 }, bb_mid: { period: 20 }, bb_lower: { period: 20 },
};

function indicatorOperand(name = "sma", period = 50) {
  return { kind: "indicator", name, params: { ...DEFAULT_PARAMS[name], ...(name === "sma" || name === "ema" || name === "rsi" ? { period } : {}) } };
}
function defaultCondition() {
  return {
    left: indicatorOperand("sma", 50),
    operator: "crosses_above",
    right: indicatorOperand("sma", 200),
  };
}
function defaultConfig() {
  return {
    entry: [defaultCondition()],
    exit: [{
      left: indicatorOperand("sma", 50), operator: "crosses_below",
      right: indicatorOperand("sma", 200),
    }],
    settings: {
      stop_loss_pct: 0, take_profit_pct: 0, risk_per_trade_pct: 2,
      position_size_pct: 100, commission_pct: 0.05, slippage_pct: 0.05,
    },
  };
}

function OperandEditor({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const kind = value?.kind || "indicator";
  function setKind(k: string) {
    if (k === "indicator") onChange(indicatorOperand("sma", 50));
    else if (k === "price") onChange({ kind: "price", field: "close" });
    else onChange({ kind: "value", value: 30 });
  }
  return (
    <div className="flex flex-wrap gap-1 items-center">
      <select className="select" style={{ width: 110 }} value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="indicator">Indicator</option>
        <option value="price">Price</option>
        <option value="value">Number</option>
      </select>
      {kind === "indicator" && (
        <>
          <select className="select" style={{ width: 170 }} value={value.name}
                  onChange={(e) => onChange(indicatorOperand(e.target.value))}>
            {INDICATORS.map((i) => <option key={i.name} value={i.name}>{i.label}</option>)}
          </select>
          {(INDICATORS.find((i) => i.name === value.name)?.params || []).map((p) => (
            <label key={p} className="text-xs muted flex items-center gap-1">
              {p}
              <input className="input" style={{ width: 64 }} type="number" value={value.params?.[p] ?? ""}
                     onChange={(e) => onChange({ ...value, params: { ...value.params, [p]: Number(e.target.value) } })} />
            </label>
          ))}
        </>
      )}
      {kind === "price" && (
        <select className="select" style={{ width: 110 }} value={value.field}
                onChange={(e) => onChange({ ...value, field: e.target.value })}>
          <option value="close">Close</option><option value="open">Open</option>
          <option value="high">High</option><option value="low">Low</option>
        </select>
      )}
      {kind === "value" && (
        <input className="input" style={{ width: 100 }} type="number" value={value.value}
               onChange={(e) => onChange({ ...value, value: Number(e.target.value) })} />
      )}
    </div>
  );
}

function ConditionList({ title, hint, conditions, onChange }: {
  title: string; hint: string; conditions: any[]; onChange: (c: any[]) => void;
}) {
  const dragIdx = useRef<number | null>(null);
  function move(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= conditions.length) return;
    const copy = [...conditions];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  }
  function drop(to: number) {
    const from = dragIdx.current;
    if (from === null || from === to) return;
    const copy = [...conditions];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    onChange(copy);
    dragIdx.current = null;
  }
  return (
    <div className="card mb-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold">{title}</h3>
        <button className="btn small" onClick={() => onChange([...conditions, defaultCondition()])}>+ Add condition</button>
      </div>
      <p className="muted text-xs mb-3">{hint} (All conditions must be true. Drag blocks or use ↑ ↓ to reorder.)</p>
      {conditions.length === 0 && <p className="muted text-sm">No conditions.</p>}
      {conditions.map((c, i) => (
        <div key={i} draggable
             onDragStart={() => (dragIdx.current = i)}
             onDragOver={(e) => e.preventDefault()}
             onDrop={() => drop(i)}
             className="rounded-lg border border-[#1e2a3f] bg-[#0a0f1a] p-3 mb-2 cursor-move">
          <div className="flex flex-wrap items-center gap-2">
            <span className="muted cursor-move" title="Drag to reorder">⠿</span>
            <OperandEditor value={c.left} onChange={(v) => {
              const copy = [...conditions]; copy[i] = { ...c, left: v }; onChange(copy);
            }} />
            <select className="select" style={{ width: 140 }} value={c.operator}
                    onChange={(e) => {
                      const copy = [...conditions]; copy[i] = { ...c, operator: e.target.value }; onChange(copy);
                    }}>
              {OPERATORS.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
            </select>
            <OperandEditor value={c.right} onChange={(v) => {
              const copy = [...conditions]; copy[i] = { ...c, right: v }; onChange(copy);
            }} />
            <span className="ml-auto flex gap-1">
              <button className="btn small" onClick={() => move(i, -1)}>↑</button>
              <button className="btn small" onClick={() => move(i, 1)}>↓</button>
              <button className="btn small red" onClick={() => onChange(conditions.filter((_, j) => j !== i))}>✕</button>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

const STARTER_CODE = `import pandas as pd

def generate_signals(df):
    # Return 1 (be long), 0 (stay flat) or -1 (be short) for each bar.
    fast = df['close'].rolling(50).mean()
    slow = df['close'].rolling(200).mean()
    return (fast > slow).astype(int).fillna(0)
`;

export default function Builder() {
  const ready = useRequireAuth();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [examples, setExamples] = useState<any[]>([]);
  const [current, setCurrent] = useState<any>(null); // editable copy
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [validating, setValidating] = useState(false);

  async function load() {
    const d = await api("/api/strategies");
    setStrategies(d.strategies);
    const ex = await api("/api/strategies/examples");
    setExamples(ex.examples);
  }
  useEffect(() => { if (ready) load().catch((e) => setErr(e.message)); }, [ready]);

  function newStrategy(kind: "rules" | "python") {
    setCurrent({
      id: null, name: kind === "rules" ? "My Rule Strategy" : "My Python Strategy",
      kind, description: "", config: defaultConfig(), code: STARTER_CODE,
    });
    setMsg(""); setErr("");
  }
  function edit(s: Strategy) {
    setCurrent({ ...s, config: { ...defaultConfig(), ...(s.config || {}) } });
    setMsg(""); setErr("");
  }
  async function save() {
    setErr(""); setMsg("");
    try {
      const body = {
        name: current.name, kind: current.kind, description: current.description || "",
        config: current.config, code: current.code || "",
      };
      const saved = current.id
        ? await api(`/api/strategies/${current.id}`, { method: "PUT", body: JSON.stringify(body) })
        : await api("/api/strategies", { method: "POST", body: JSON.stringify(body) });
      setCurrent({ ...saved, config: { ...defaultConfig(), ...(saved.config || {}) } });
      setMsg("Saved.");
      load();
    } catch (e: any) { setErr(e.message); }
  }
  async function duplicate() {
    if (!current?.id) return;
    await api(`/api/strategies/${current.id}/duplicate`, { method: "POST" });
    setMsg("Duplicated."); load();
  }
  async function remove() {
    if (!current?.id) return;
    await api(`/api/strategies/${current.id}`, { method: "DELETE" });
    setCurrent(null); setMsg("Deleted."); load();
  }
  async function addExample(i: number) {
    const s = await api("/api/strategies/from-example", { method: "POST", body: JSON.stringify({ index: i }) });
    setMsg(`Added example "${s.name}" to your strategies.`); load(); edit(s);
  }
  async function validate() {
    setValidating(true); setErr(""); setMsg("");
    try {
      const r = await api("/api/strategies/validate-code", {
        method: "POST", body: JSON.stringify({ code: current.code }),
      });
      if (r.valid) setMsg("Code is valid ✓ (static check passed — it runs in a restricted sandbox)");
      else setErr("Invalid: " + r.errors.join("; "));
    } catch (e: any) { setErr(e.message); }
    setValidating(false);
  }

  if (!ready) return null;
  const cfg = current?.config || defaultConfig();
  const settings = cfg.settings || {};

  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-1">Algorithm Builder</h1>
      <p className="muted text-sm mb-5">Create strategies from blocks or Python. Strategies only ever run on historical data and paper money here.</p>
      {msg && <p className="pos text-sm mb-3">{msg}</p>}
      {err && <p className="neg text-sm mb-3">{err}</p>}

      <div className="grid lg:grid-cols-[280px_1fr] gap-6 items-start">
        <div className="card">
          <h2 className="font-bold mb-3">My strategies</h2>
          <div className="flex flex-col gap-1 mb-3">
            {strategies.map((s) => (
              <button key={s.id} onClick={() => edit(s)}
                      className={`text-left px-3 py-2 rounded-lg ${current?.id === s.id ? "bg-[#16233c]" : "hover:bg-[#111a2b]"}`}>
                {s.name}
                <span className="muted text-xs block">{s.kind === "python" ? "Python code" : "Rule blocks"}</span>
              </button>
            ))}
            {strategies.length === 0 && <p className="muted text-sm">None yet.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn small primary" onClick={() => newStrategy("rules")}>+ Rules</button>
            <button className="btn small primary" onClick={() => newStrategy("python")}>+ Python</button>
          </div>
          <h3 className="font-bold mt-5 mb-2 text-sm">Starter examples</h3>
          <div className="flex flex-col gap-1">
            {examples.map((ex, i) => (
              <button key={i} className="btn small justify-start" onClick={() => addExample(i)}>+ {ex.name}</button>
            ))}
          </div>
        </div>

        <div>
          {!current && <div className="card muted">Pick a strategy on the left, add a starter example, or create a new one.</div>}
          {current && (
            <>
              <div className="card mb-4">
                <label className="label">Strategy name</label>
                <input className="input mb-3" value={current.name}
                       onChange={(e) => setCurrent({ ...current, name: e.target.value })} />
                <label className="label">Description</label>
                <input className="input mb-3" value={current.description || ""}
                       onChange={(e) => setCurrent({ ...current, description: e.target.value })} />
                <div className="flex gap-2">
                  <button className={`btn small ${current.kind === "rules" ? "primary" : ""}`}
                          onClick={() => setCurrent({ ...current, kind: "rules" })}>Visual blocks</button>
                  <button className={`btn small ${current.kind === "python" ? "primary" : ""}`}
                          onClick={() => setCurrent({ ...current, kind: "python" })}>Python code</button>
                </div>
              </div>

              {current.kind === "rules" && (
                <>
                  <ConditionList title="Entry conditions — go long when…" hint="Example: SMA(50) crosses above SMA(200)"
                                 conditions={cfg.entry || []}
                                 onChange={(c) => setCurrent({ ...current, config: { ...cfg, entry: c } })} />
                  <ConditionList title="Exit conditions — close the position when…" hint="Example: SMA(50) crosses below SMA(200), or RSI(14) > 70"
                                 conditions={cfg.exit || []}
                                 onChange={(c) => setCurrent({ ...current, config: { ...cfg, exit: c } })} />
                  <div className="card mb-4">
                    <h3 className="font-bold mb-3">Risk &amp; execution settings</h3>
                    <div className="grid sm:grid-cols-3 gap-3">
                      {[
                        ["stop_loss_pct", "Stop-loss % (0 = off)"],
                        ["take_profit_pct", "Take-profit % (0 = off)"],
                        ["risk_per_trade_pct", "Risk per trade % (caps size when stop-loss set)"],
                        ["position_size_pct", "Position size % of capital"],
                        ["commission_pct", "Commission % per fill"],
                        ["slippage_pct", "Slippage % per fill"],
                      ].map(([key, label]) => (
                        <div key={key}>
                          <label className="label">{label}</label>
                          <input className="input" type="number" step="0.01" value={settings[key] ?? ""}
                                 onChange={(e) => setCurrent({
                                   ...current,
                                   config: { ...cfg, settings: { ...settings, [key]: Number(e.target.value) } },
                                 })} />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {current.kind === "python" && (
                <div className="card mb-4">
                  <h3 className="font-bold mb-1">Python strategy</h3>
                  <p className="muted text-xs mb-3">
                    Define <code>generate_signals(df)</code> returning 1 / 0 / −1 per bar. Only NumPy and Pandas
                    imports are allowed; dangerous calls are rejected by a static check, and backtests run the
                    code in a restricted sandbox (best-effort — see README).
                  </p>
                  <textarea className="textarea font-mono text-[13px]" rows={16} value={current.code}
                            onChange={(e) => setCurrent({ ...current, code: e.target.value })} />
                  <button className="btn small mt-3" onClick={validate} disabled={validating}>
                    {validating ? "Checking…" : "Validate code"}
                  </button>
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                <button className="btn primary" onClick={save}>Save strategy</button>
                {current.id && <button className="btn" onClick={duplicate}>Duplicate</button>}
                {current.id && <button className="btn red" onClick={remove}>Delete</button>}
                {current.id && <a className="btn" href="/backtest">Backtest it →</a>}
              </div>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
