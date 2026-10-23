"""Strategy signal generation + event-driven backtester.

Backtest rules (deliberately conservative, no look-ahead bias):
- Signals are computed from data up to and including bar t's close.
- Orders execute at bar t+1's OPEN, adjusted by slippage.
- Commission is charged on every fill (entry and exit).
- Stop-loss / take-profit are checked intrabar; if both trigger on the
  same bar, the stop-loss wins (conservative).
- After a stop-loss/take-profit exit, the same direction cannot re-enter
  until the signal has moved away from it (prevents instant re-entry).
- Any position still open at the end is closed at the final close.
"""
import math

import numpy as np
import pandas as pd

from . import indicators as ind
from .sandbox import run_strategy_code


# ---------------------------------------------------------------- operands
def _operand_series(df: pd.DataFrame, operand: dict, cache: dict) -> pd.Series:
    kind = operand.get("kind", "indicator")
    if kind == "value":
        return pd.Series(float(operand.get("value", 0)), index=df.index, dtype=float)
    if kind == "price":
        field = operand.get("field", "close")
        return df[field].astype(float)
    name = operand.get("name", "sma")
    params = operand.get("params") or {}
    key = (name, tuple(sorted(params.items())))
    if key in cache:
        return cache[key]
    close = df["close"].astype(float)
    period = int(params.get("period", 14))
    if name == "sma":
        s = ind.sma(close, period)
    elif name == "ema":
        s = ind.ema(close, period)
    elif name == "rsi":
        s = ind.rsi(close, period)
    elif name == "macd":
        s = ind.macd(close, int(params.get("fast", 12)), int(params.get("slow", 26)),
                     int(params.get("signal", 9)))[0]
    elif name == "macd_signal":
        s = ind.macd(close, int(params.get("fast", 12)), int(params.get("slow", 26)),
                     int(params.get("signal", 9)))[1]
    elif name == "macd_hist":
        s = ind.macd(close, int(params.get("fast", 12)), int(params.get("slow", 26)),
                     int(params.get("signal", 9)))[2]
    elif name == "bb_upper":
        s = ind.bollinger(close, period, float(params.get("std", 2.0)))[0]
    elif name == "bb_mid":
        s = ind.bollinger(close, period, float(params.get("std", 2.0)))[1]
    elif name == "bb_lower":
        s = ind.bollinger(close, period, float(params.get("std", 2.0)))[2]
    else:
        s = close
    cache[key] = s
    return s


def _eval_condition(df: pd.DataFrame, cond: dict, cache: dict) -> pd.Series:
    left = _operand_series(df, cond.get("left") or {}, cache)
    right = _operand_series(df, cond.get("right") or {}, cache)
    op = cond.get("operator", ">")
    if op == "crosses_above":
        out = (left.shift(1) <= right.shift(1)) & (left > right)
    elif op == "crosses_below":
        out = (left.shift(1) >= right.shift(1)) & (left < right)
    elif op == ">":
        out = left > right
    elif op == "<":
        out = left < right
    elif op == ">=":
        out = left >= right
    elif op == "<=":
        out = left <= right
    else:
        out = left > right
    return out.fillna(False)


def rule_signals(df: pd.DataFrame, config: dict) -> pd.Series:
    """Desired position after each bar's close: 1 = long, 0 = flat."""
    cache: dict = {}
    entry_conds = config.get("entry") or []
    exit_conds = config.get("exit") or []
    if entry_conds:
        entry = _eval_condition(df, entry_conds[0], cache)
        for c in entry_conds[1:]:
            entry = entry & _eval_condition(df, c, cache)
    else:
        entry = pd.Series(False, index=df.index)
    if exit_conds:
        exit_ = _eval_condition(df, exit_conds[0], cache)
        for c in exit_conds[1:]:
            exit_ = exit_ & _eval_condition(df, c, cache)
    else:
        exit_ = pd.Series(False, index=df.index)

    desired = np.zeros(len(df), dtype=int)
    in_pos = False
    entry_v = entry.to_numpy()
    exit_v = exit_.to_numpy()
    for i in range(len(df)):
        if not in_pos and entry_v[i]:
            in_pos = True
        elif in_pos and exit_v[i]:
            in_pos = False
        desired[i] = 1 if in_pos else 0
    return pd.Series(desired, index=df.index)


def strategy_signals(df: pd.DataFrame, kind: str, config: dict, code: str):
    """Returns (signals Series of desired position in {-1,0,1}, error str)."""
    if kind == "python":
        bars = [{
            "time": int(t), "open": float(o), "high": float(h), "low": float(lo),
            "close": float(c), "volume": float(v),
        } for t, o, h, lo, c, v in zip(
            df["time"], df["open"], df["high"], df["low"], df["close"], df["volume"])]
        res = run_strategy_code(code or "", bars)
        if not res.get("ok"):
            return None, res.get("error", "Strategy code failed")
        vals = res["signals"]
        if len(vals) != len(df):
            return None, "generate_signals must return one value per bar"
        return pd.Series(vals, index=df.index, dtype=float), None
    return rule_signals(df, config or {}), None


# ---------------------------------------------------------------- backtest
def run_backtest(df: pd.DataFrame, signals: pd.Series, settings: dict,
                 periods_per_year: int = 252) -> dict:
    capital = float(settings.get("initial_capital", 100000))
    commission = float(settings.get("commission_pct", 0.05)) / 100.0
    slippage = float(settings.get("slippage_pct", 0.05)) / 100.0
    sl_pct = float(settings.get("stop_loss_pct") or 0)
    tp_pct = float(settings.get("take_profit_pct") or 0)
    size_pct = float(settings.get("position_size_pct", 100)) / 100.0
    risk_pct = settings.get("risk_per_trade_pct")
    risk_pct = float(risk_pct) if risk_pct else 0.0

    n = len(df)
    opens = df["open"].to_numpy(dtype=float)
    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    closes = df["close"].to_numpy(dtype=float)
    times = df["time"].to_numpy()
    sig = signals.fillna(0).astype(int).to_numpy()

    cash = capital
    qty = 0.0            # signed shares
    entry_price = 0.0
    entry_time = None
    entry_commission = 0.0
    blocked_dir = 0
    trades = []
    equity_curve = []

    def close_position(i, raw_price, reason):
        nonlocal cash, qty, entry_price, entry_time, entry_commission
        direction = 1 if qty > 0 else -1
        # slippage always works against the trader
        fill = raw_price * (1 - slippage) if direction == 1 else raw_price * (1 + slippage)
        exit_commission = abs(qty) * fill * commission
        gross = (fill - entry_price) * qty  # signed qty handles short pnl
        pnl = gross - entry_commission - exit_commission
        cash += qty * fill - exit_commission
        trades.append({
            "direction": "long" if direction == 1 else "short",
            "entry_time": int(entry_time), "exit_time": int(times[i]),
            "entry_price": round(entry_price, 4), "exit_price": round(fill, 4),
            "qty": abs(qty), "pnl": round(pnl, 2),
            "return_pct": round((fill / entry_price - 1) * 100 * direction, 3) if entry_price else 0,
            "exit_reason": reason,
        })
        qty = 0.0
        entry_price = 0.0
        entry_time = None
        entry_commission = 0.0
        return direction

    for i in range(n):
        # ---- execute pending signal from previous bar's close at this open
        if i > 0:
            desired = int(sig[i - 1])
            if blocked_dir and desired != blocked_dir:
                blocked_dir = 0
            cur_dir = 0 if qty == 0 else (1 if qty > 0 else -1)
            if desired != cur_dir and desired != blocked_dir:
                if qty != 0:
                    close_position(i, opens[i], "signal")
                    cur_dir = 0
                if desired != 0:
                    fill = opens[i] * (1 + slippage) if desired == 1 else opens[i] * (1 - slippage)
                    equity_now = cash
                    alloc = equity_now * size_pct
                    # size so that fill + entry commission fit inside alloc
                    q = math.floor(alloc / (fill * (1 + commission)))
                    if sl_pct > 0 and risk_pct > 0:
                        max_loss_per_share = fill * sl_pct / 100.0
                        if max_loss_per_share > 0:
                            q = min(q, math.floor(equity_now * risk_pct / 100.0 / max_loss_per_share))
                    if q >= 1:
                        entry_commission = q * fill * commission
                        signed = q * desired
                        # longs must be affordable; shorts credit proceeds
                        affordable = desired == -1 or (signed * fill + entry_commission) <= cash + 1e-9
                        if affordable:
                            cash -= signed * fill + entry_commission
                            qty = signed
                            entry_price = fill
                            entry_time = times[i]
                        else:
                            entry_commission = 0.0
        # ---- intrabar stop-loss / take-profit (stop-loss checked first)
        if qty != 0 and sl_pct > 0 or qty != 0 and tp_pct > 0:
            direction = 1 if qty > 0 else -1
            exit_done = False
            if sl_pct > 0:
                sl_price = entry_price * (1 - sl_pct / 100.0) if direction == 1 \
                    else entry_price * (1 + sl_pct / 100.0)
                hit = lows[i] <= sl_price if direction == 1 else highs[i] >= sl_price
                if hit:
                    close_position(i, sl_price, "stop_loss")
                    exit_done = True
            if not exit_done and tp_pct > 0:
                tp_price = entry_price * (1 + tp_pct / 100.0) if direction == 1 \
                    else entry_price * (1 - tp_pct / 100.0)
                hit = highs[i] >= tp_price if direction == 1 else lows[i] <= tp_price
                if hit:
                    close_position(i, tp_price, "take_profit")
                    exit_done = True
            if exit_done:
                blocked_dir = direction
        # ---- mark to market at close
        equity = cash + qty * closes[i]
        equity_curve.append({"time": int(times[i]), "equity": round(equity, 2)})

    # ---- close anything left at the final close
    if qty != 0:
        close_position(n - 1, closes[n - 1], "end_of_data")
        equity_curve.append({"time": int(times[n - 1]), "equity": round(cash, 2)})

    final_equity = cash
    total_return = (final_equity / capital - 1) * 100 if capital else 0.0

    # max drawdown from equity curve
    peak = -np.inf
    max_dd = 0.0
    eq = np.array([p["equity"] for p in equity_curve], dtype=float)
    for v in eq:
        peak = max(peak, v)
        if peak > 0:
            max_dd = min(max_dd, (v / peak - 1) * 100)

    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else (None if gross_win == 0 else 999.0)
    win_rate = (len(wins) / len(pnls) * 100) if pnls else 0.0

    # Sharpe from per-bar equity returns, annualised (risk-free rate = 0)
    sharpe = None
    if len(eq) > 3:
        rets = np.diff(eq) / np.maximum(eq[:-1], 1e-9)
        sd = rets.std(ddof=1)
        if sd > 0:
            sharpe = round(float(rets.mean() / sd * math.sqrt(periods_per_year)), 3)

    years = n / periods_per_year if periods_per_year else 0
    cagr = None
    if years >= 0.04 and final_equity > 0 and capital > 0:
        cagr = round(((final_equity / capital) ** (1 / years) - 1) * 100, 2)

    bh_return = (closes[-1] / opens[0] - 1) * 100 if opens[0] else 0.0

    metrics = {
        "total_return_pct": round(total_return, 2),
        "cagr_pct": cagr,
        "max_drawdown_pct": round(abs(max_dd), 2),
        "win_rate_pct": round(win_rate, 2),
        "num_trades": len(trades),
        "profit_factor": round(profit_factor, 3) if profit_factor is not None else None,
        "avg_win": round(gross_win / len(wins), 2) if wins else 0.0,
        "avg_loss": round(-gross_loss / len(losses), 2) if losses else 0.0,
        "expectancy": round(sum(pnls) / len(pnls), 2) if pnls else 0.0,
        "sharpe": sharpe,
        "final_equity": round(final_equity, 2),
        "initial_capital": capital,
        "benchmark_return_pct": round(bh_return, 2),
        "alpha_pct": round(total_return - bh_return, 2),
        "disclaimer": "Past performance does not guarantee future results. "
                      "Sharpe uses a 0% risk-free rate and is annualised approximately.",
    }
    return {"metrics": metrics, "trades": trades, "equity_curve": equity_curve}
