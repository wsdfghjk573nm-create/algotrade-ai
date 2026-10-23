"""AlgoTrade AI verification suite.

Part 1: pure unit checks (indicators vs hand-computed values, backtester
mechanics vs independent recomputation, sandbox AST rules).
Part 2: end-to-end API checks against a running server (BASE_URL env,
default http://127.0.0.1:8009).

Run:  venv/bin/python tests/test_api.py
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd

PASSED = []
FAILED = []


def check(name, cond, extra=""):
    if cond:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL  {name}  {extra}")


# ============================================================ unit: indicators
print("== Indicators (hand-computed) ==")
from app import indicators as ind  # noqa: E402

s = pd.Series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=float)
sma3 = ind.sma(s, 3)
check("SMA(3) last value = mean(8,9,10) = 9", abs(sma3.iloc[-1] - 9.0) < 1e-9)
check("SMA(3) first two are NaN", math.isnan(sma3.iloc[0]) and math.isnan(sma3.iloc[1]))

up = pd.Series(np.arange(1, 40, dtype=float))
down = pd.Series(np.arange(40, 1, -1, dtype=float))
check("RSI of strictly rising series = 100", abs(ind.rsi(up, 14).iloc[-1] - 100.0) < 1e-6)
check("RSI of strictly falling series = 0", abs(ind.rsi(down, 14).iloc[-1] - 0.0) < 1e-6)


def rsi_manual(prices, period=14):
    """Independent Wilder RSI implementation for cross-checking."""
    gains, losses = [], []
    for i in range(1, len(prices)):
        d = prices[i] - prices[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    vals = [None] * period
    vals.append(100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l))
    for i in range(period, len(gains)):
        avg_g = (avg_g * (period - 1) + gains[i]) / period
        avg_l = (avg_l * (period - 1) + losses[i]) / period
        vals.append(100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l))
    return vals


mixed = [100, 102, 101, 105, 103, 107, 104, 108, 110, 106, 109, 112, 111, 115,
         113, 117, 114, 118, 120, 116, 119, 122, 121, 125, 123, 127, 126, 130]
manual = rsi_manual(mixed, 14)
lib = ind.rsi(pd.Series(mixed, dtype=float), 14)
diffs = [abs(m - l) for m, l in zip(manual, lib.tolist())
         if m is not None and not (isinstance(l, float) and math.isnan(l))]
check("RSI matches independent Wilder implementation (max diff < 0.6)",
      diffs and max(diffs) < 0.6, f"max diff {max(diffs) if diffs else 'n/a'}")

m_line, s_line, hist = ind.macd(pd.Series(mixed * 4, dtype=float))
check("MACD hist = macd - signal", abs((m_line - s_line - hist).abs().max()) < 1e-9)
bbu, bbm, bbl = ind.bollinger(pd.Series(mixed, dtype=float), 20, 2.0)
check("Bollinger mid = SMA20", abs(bbm.iloc[-1] - pd.Series(mixed).rolling(20).mean().iloc[-1]) < 1e-9)

# ============================================================ unit: backtester
print("== Backtester mechanics (independent recomputation) ==")
from app import engine  # noqa: E402


def make_df(closes, opens=None):
    closes = np.array(closes, dtype=float)
    if opens is None:
        opens = closes.copy()
        opens[1:] = closes[:-1]
        opens[0] = closes[0]
    highs = np.maximum(opens, closes) + 0.05
    lows = np.minimum(opens, closes) - 0.05
    return pd.DataFrame({"time": np.arange(1_600_000_000, 1_600_000_000 + len(closes) * 86400, 86400),
                         "open": opens, "high": highs, "low": lows, "close": closes,
                         "volume": 1000})


# --- no look-ahead + costs, golden-cross style signals computed from closes
closes = [100 - i * 0.02 for i in range(210)] + [96 + (i + 1) * 0.9 for i in range(110)]
df = make_df(closes)
cfg = {"entry": [{"left": {"kind": "indicator", "name": "sma", "params": {"period": 50}},
                  "operator": "crosses_above",
                  "right": {"kind": "indicator", "name": "sma", "params": {"period": 200}}}],
       "exit": [{"left": {"kind": "indicator", "name": "sma", "params": {"period": 50}},
                 "operator": "crosses_below",
                 "right": {"kind": "indicator", "name": "sma", "params": {"period": 200}}}]}
signals = engine.rule_signals(df, cfg)
settings = {"initial_capital": 100000, "commission_pct": 0.1, "slippage_pct": 0.1,
            "stop_loss_pct": 0, "take_profit_pct": 0, "position_size_pct": 100,
            "risk_per_trade_pct": 0}
result = engine.run_backtest(df, signals, settings)
trades = result["trades"]
check("golden-cross backtest produced >= 1 trade", len(trades) >= 1, f"trades={len(trades)}")
if trades:
    t0 = trades[0]
    # first index where desired position flips 0 -> 1
    sig_np = signals.to_numpy()
    cross_idx = next(i for i in range(1, len(sig_np)) if sig_np[i] == 1 and sig_np[i - 1] == 0)
    expected_entry_time = int(df["time"].iloc[cross_idx + 1])
    expected_entry_price = float(df["open"].iloc[cross_idx + 1]) * 1.001  # +0.1% slippage
    check("NO LOOK-AHEAD: entry executed at NEXT bar open", t0["entry_time"] == expected_entry_time,
          f"{t0['entry_time']} vs {expected_entry_time}")
    check("slippage applied to entry fill", abs(t0["entry_price"] - expected_entry_price) < 0.01,
          f"{t0['entry_price']} vs {expected_entry_price}")
    # independent recomputation of this trade's P&L
    qty = math.floor(100000 / (expected_entry_price * 1.001))  # fill + 0.1% commission
    entry_comm = qty * t0["entry_price"] * 0.001
    exit_comm = qty * t0["exit_price"] * 0.001
    pnl_manual = (t0["exit_price"] - t0["entry_price"]) * qty - entry_comm - exit_comm
    check("trade P&L matches independent recomputation (incl. both commissions)",
          abs(pnl_manual - t0["pnl"]) < 1.0, f"{pnl_manual:.2f} vs {t0['pnl']}")
    check("qty sizing = floor(capital / fill)", t0["qty"] == qty, f"{t0['qty']} vs {qty}")
check("metrics contain required fields",
      all(k in result["metrics"] for k in
          ("total_return_pct", "max_drawdown_pct", "win_rate_pct", "num_trades",
           "profit_factor", "avg_win", "avg_loss", "expectancy", "sharpe",
           "benchmark_return_pct", "alpha_pct")))

# --- stop-loss: manual signal long from bar 5; bar 8 dips through the stop
closes2 = [100.0] * 6 + [101.0, 100.5, 88.0, 95.0, 96.0, 97.0]
opens2 = [100.0] * 12
df2 = pd.DataFrame({"time": np.arange(1_600_000_000, 1_600_000_000 + 12 * 86400, 86400),
                    "open": opens2,
                    "high": [100.2] * 6 + [101.2, 100.7, 95.5, 95.2, 96.2, 97.2],
                    "low": [99.8] * 6 + [100.8, 100.2, 87.5, 94.8, 95.8, 96.8],
                    "close": closes2, "volume": 1000})
sig2 = pd.Series([0] * 5 + [1] * 7)
settings2 = {"initial_capital": 10000, "commission_pct": 0.0, "slippage_pct": 0.0,
             "stop_loss_pct": 10, "take_profit_pct": 0, "position_size_pct": 100,
             "risk_per_trade_pct": 0}
res2 = engine.run_backtest(df2, sig2, settings2)
check("stop-loss trade exits with reason stop_loss",
      len(res2["trades"]) == 1 and res2["trades"][0]["exit_reason"] == "stop_loss",
      str(res2["trades"]))
if res2["trades"]:
    check("stop-loss exit price = entry*(1-10%) = 90",
          abs(res2["trades"][0]["exit_price"] - 90.0) < 1e-6,
          str(res2["trades"][0]["exit_price"]))

# --- sandbox AST rules
print("== Sandbox ==")
from app.sandbox import run_strategy_code, validate_code  # noqa: E402

check("AST rejects 'import os'", len(validate_code("import os\ndef generate_signals(df):\n    return df['close']")) > 0)
check("AST rejects open()", len(validate_code("def generate_signals(df):\n    open('x')\n    return df['close']")) > 0)
check("AST rejects pd.read_csv", len(validate_code("def generate_signals(df):\n    return pd.read_csv('x')")) > 0)
check("AST accepts a valid strategy", validate_code(
    "import pandas as pd\ndef generate_signals(df):\n    return (df['close'].rolling(5).mean() > 0).astype(int)") == [])
bars = [{"time": i, "open": 10, "high": 10, "low": 10, "close": 10 + i, "volume": 1} for i in range(30)]
ran = run_strategy_code("def generate_signals(df):\n    return (df['close'] > df['close'].rolling(10).mean()).astype(int).fillna(0)", bars)
check("sandbox executes valid strategy in subprocess", ran.get("ok") is True and len(ran.get("signals", [])) == 30,
      str(ran)[:200])
ran_bad = run_strategy_code("import subprocess\ndef generate_signals(df):\n    return df['close']", bars)
check("sandbox refuses subprocess import before running", ran_bad.get("ok") is False)

# ============================================================ API end-to-end
print("== API end-to-end ==")
import httpx  # noqa: E402

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8009")
c = httpx.Client(base_url=BASE, timeout=60.0, trust_env=False)

r = c.get("/api/health")
check("health 200", r.status_code == 200)

r = c.post("/api/auth/register", json={"name": "Tester A", "email": "a@test.local", "password": "password123"})
check("register user A", r.status_code == 200, r.text[:200])
tokA = r.json()["token"] if r.status_code == 200 else ""
hA = {"Authorization": f"Bearer {tokA}"}
r = c.post("/api/auth/register", json={"name": "Tester B", "email": "b@test.local", "password": "password123"})
tokB = r.json()["token"] if r.status_code == 200 else ""
hB = {"Authorization": f"Bearer {tokB}"}
check("register user B", r.status_code == 200, r.text[:200])

r = c.post("/api/auth/login", json={"email": "a@test.local", "password": "wrong-pass"})
check("wrong password -> 401", r.status_code == 401)
r = c.post("/api/auth/login", json={"email": "a@test.local", "password": "password123"})
check("login user A", r.status_code == 200)
r = c.get("/api/auth/me", headers=hA)
check("me returns A's email", r.status_code == 200 and r.json()["email"] == "a@test.local")
r = c.get("/api/auth/me")
check("no token -> 401", r.status_code == 401)

r = c.get("/api/strategies", headers=hA)
mine = r.json()["strategies"]
check("new user seeded with 3 example strategies", len(mine) == 3, f"got {len(mine)}")
golden = next((s for s in mine if "Golden Cross" in s["name"]), None)
check("golden cross example present", golden is not None)

r = c.post("/api/strategies", headers=hA,
           json={"name": "My RSI", "kind": "rules", "description": "",
                 "config": {"entry": [], "exit": [], "settings": {}}, "code": ""})
check("create strategy", r.status_code == 200, r.text[:200])
my_id = r.json()["id"] if r.status_code == 200 else None
r = c.get(f"/api/strategies/{my_id}", headers=hB)
check("cross-user strategy access -> 404", r.status_code == 404)
r = c.post(f"/api/strategies/{my_id}/duplicate", headers=hA)
check("duplicate own strategy", r.status_code == 200)
r = c.delete(f"/api/strategies/{r.json()['id']}", headers=hA)
check("delete strategy", r.status_code == 200)

r = c.post("/api/strategies", headers=hA,
           json={"name": "Evil", "kind": "python", "description": "", "config": {},
                 "code": "import os\ndef generate_signals(df):\n    return df['close']"})
check("create malicious python strategy -> 422", r.status_code == 422, r.text[:200])
r = c.post("/api/strategies/validate-code", headers=hA,
           json={"code": "import os\ndef generate_signals(df):\n    return df['close']"})
check("validate-code flags import os", r.status_code == 200 and r.json()["valid"] is False)

r = c.get("/api/market/ohlcv", params={"symbol": "ZZZZUNKNOWN", "range": "3mo"})
d = r.json()
check("unknown symbol -> SAMPLE data, labelled", r.status_code == 200 and d["source"] == "sample"
      and "SAMPLE" in d["source_label"] and len(d["bars"]) > 30, str(d)[:200])
r = c.get("/api/market/indicators", params={"symbol": "ZZZZUNKNOWN", "range": "1y"})
d = r.json()
check("indicators endpoint returns rsi14 series aligned with bars",
      len(d["indicators"]["rsi14"]) == len(d["bars"]))

# backtest golden cross via API on deterministic sample-labelled symbol
r = c.post("/api/backtests/run", headers=hA,
           json={"strategy_id": golden["id"], "symbol": "ZZZZUNKNOWN", "range": "5y",
                 "initial_capital": 100000})
check("backtest run (golden cross, sample data)", r.status_code == 200, r.text[:300])
if r.status_code == 200:
    run = r.json()
    check("backtest records data_source=sample", run["data_source"] == "sample")
    check("backtest metrics complete", run["metrics"]["num_trades"] == len(run["trades"]))
    if run["trades"]:
        t = run["trades"][0]
        check("trade rows carry entry/exit/pnl/reason",
              all(k in t for k in ("entry_time", "exit_time", "entry_price", "exit_price", "pnl", "exit_reason")))
r = c.post("/api/backtests/run", headers=hB,
           json={"strategy_id": golden["id"], "symbol": "AAPL", "range": "1y",
                 "initial_capital": 100000})
check("cross-user backtest -> 404", r.status_code == 404)

# python strategy backtest via API (sma-fast code strategy)
code = ("import pandas as pd\n"
        "def generate_signals(df):\n"
        "    fast = df['close'].rolling(10).mean()\n"
        "    slow = df['close'].rolling(30).mean()\n"
        "    return (fast > slow).astype(int).fillna(0)\n")
r = c.post("/api/strategies", headers=hA,
           json={"name": "Py SMA", "kind": "python", "description": "", "config": {"settings": {}}, "code": code})
check("create valid python strategy", r.status_code == 200, r.text[:200])
if r.status_code == 200:
    r2 = c.post("/api/backtests/run", headers=hA,
                json={"strategy_id": r.json()["id"], "symbol": "ZZZZUNKNOWN", "range": "1y",
                      "initial_capital": 50000})
    check("python strategy backtest executes in sandbox", r2.status_code == 200, r2.text[:300])

# paper trading maths
r = c.post("/api/paper/reset", headers=hA, json={"balance": 100000, "currency": "INR"})
check("paper reset", r.status_code == 200)
q = c.get("/api/market/quote/ZZZZUNKNOWN").json()
px = q["price"]
fill_buy = round(px * 1.0005, 4)
r = c.post("/api/paper/orders", headers=hA,
           json={"symbol": "ZZZZUNKNOWN", "side": "buy", "qty": 10, "order_type": "market"})
check("paper buy executes", r.status_code == 200, r.text[:200])
if r.status_code == 200:
    check("paper buy fill = quote*(1+0.05% slippage)", abs(r.json()["order"]["price"] - fill_buy) < 0.01,
          f"{r.json()['order']['price']} vs {fill_buy}")
    expected_cash = 100000 - 10 * fill_buy
    check("cash reduced by fill*qty", abs(r.json()["cash"] - round(expected_cash, 2)) < 0.05,
          f"{r.json()['cash']} vs {expected_cash}")
r = c.post("/api/paper/orders", headers=hA,
           json={"symbol": "ZZZZUNKNOWN", "side": "buy", "qty": 10_000_000, "order_type": "market"})
check("overspend rejected", r.status_code == 400)
r = c.post("/api/paper/orders", headers=hA,
           json={"symbol": "ZZZZUNKNOWN", "side": "sell", "qty": 999, "order_type": "market"})
check("oversell rejected", r.status_code == 400)
r = c.get("/api/paper/account", headers=hA)
acc = r.json()["account"]
check("account equity = cash + market value", abs(acc["equity"] - (acc["cash"] + acc["market_value"])) < 0.1)
check("position visible with unrealised pnl", len(r.json()["positions"]) == 1)
r = c.post("/api/paper/orders", headers=hA,
           json={"symbol": "ZZZZUNKNOWN", "side": "sell", "qty": 10, "order_type": "market"})
check("paper sell executes", r.status_code == 200, r.text[:200])
r = c.get("/api/paper/orders", headers=hA)
check("order history recorded (2 fills; rejected orders not recorded)",
      len(r.json()["orders"]) == 2, str(len(r.json()["orders"])))

# watchlist
c.post("/api/watchlist", headers=hA, json={"symbol": "AAPL"})
r = c.get("/api/watchlist", headers=hA)
check("watchlist add/list", "AAPL" in r.json()["watchlist"])
c.delete("/api/watchlist/AAPL", headers=hA)
r = c.get("/api/watchlist", headers=hA)
check("watchlist remove", "AAPL" not in r.json()["watchlist"])

# marketplace
runs = c.get("/api/backtests", headers=hA).json()["backtests"]
r = c.post("/api/marketplace/publish", headers=hA, json={"strategy_id": golden["id"]})
check("publish strategy", r.status_code == 200, r.text[:200])
pub_id = r.json()["id"] if r.status_code == 200 else None
if r.status_code == 200:
    check("published stats labelled user-submitted",
          "not independently verified" in r.json()["stats_label"])
r = c.post(f"/api/marketplace/{pub_id}/rate", headers=hB, json={"stars": 5, "review": "Clear rules"})
check("another user can rate", r.status_code == 200 and r.json()["avg_rating"] == 5)
r = c.post(f"/api/marketplace/{pub_id}/clone", headers=hB)
check("another user can clone", r.status_code == 200, r.text[:200])
r = c.get("/api/marketplace")
check("marketplace lists official examples labelled",
      any(p["is_official_example"] and "Example" in p["stats_label"] for p in r.json()["published"]))

# assistant
r = c.post("/api/assistant/chat", headers=hA, json={"message": "What is RSI?"})
check("assistant explains RSI", "Relative Strength Index" in r.json()["reply"])
r = c.post("/api/assistant/chat", headers=hA,
           json={"message": "Can you guarantee profits if I use this strategy?"})
reply = r.json()["reply"]
check("assistant refuses guaranteed-profit question",
      "can't" in reply and "predict the market" in reply, reply[:120])
r = c.post("/api/assistant/chat", headers=hA, json={"message": "show me a golden cross strategy"})
check("assistant generates golden-cross sample code",
      "generate_signals" in r.json()["reply"] and "rolling(50)" in r.json()["reply"])
if runs:
    r = c.post("/api/assistant/review", headers=hA, json={"backtest_id": runs[0]["id"]})
    check("assistant reviews a real backtest", r.status_code == 200 and "drawdown" in r.json()["reply"].lower(),
          r.text[:200])

print(f"\n===== {len(PASSED)} passed, {len(FAILED)} failed =====")
if FAILED:
    print("FAILED:", FAILED)
    sys.exit(1)
