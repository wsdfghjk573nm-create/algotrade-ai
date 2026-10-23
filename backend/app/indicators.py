"""Technical indicators computed with Pandas.

All functions take a price Series and return a Series aligned to the input
(NaN where the indicator is not yet defined). RSI uses Wilder's smoothing.
"""
import numpy as np
import pandas as pd


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Canonical Wilder RSI: seed with the SMA of the first `period`
    gains/losses, then smooth with avg = (avg*(p-1) + current)/p."""
    values = series.astype(float).to_numpy()
    out = np.full(len(values), np.nan)
    if len(values) <= period:
        return pd.Series(out, index=series.index)
    deltas = np.diff(values)
    gains = np.clip(deltas, 0.0, None)
    losses = np.clip(-deltas, 0.0, None)

    def _rsi(avg_g, avg_l):
        if avg_l == 0:
            return 100.0 if avg_g > 0 else 50.0
        if avg_g == 0:
            return 0.0
        return 100.0 - 100.0 / (1.0 + avg_g / avg_l)

    avg_g = gains[:period].mean()
    avg_l = losses[:period].mean()
    out[period] = _rsi(avg_g, avg_l)
    for i in range(period, len(deltas)):
        avg_g = (avg_g * (period - 1) + gains[i]) / period
        avg_l = (avg_l * (period - 1) + losses[i]) / period
        out[i + 1] = _rsi(avg_g, avg_l)
    return pd.Series(out, index=series.index)


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    # Require the slow EMA to be defined before reporting values
    macd_line.iloc[: slow - 1] = np.nan
    signal_line.iloc[: slow + signal - 2] = np.nan
    hist.iloc[: slow + signal - 2] = np.nan
    return macd_line, signal_line, hist


def bollinger(series: pd.Series, period: int = 20, std_mult: float = 2.0):
    mid = sma(series, period)
    std = series.rolling(window=period, min_periods=period).std()
    upper = mid + std_mult * std
    lower = mid - std_mult * std
    return upper, mid, lower


def series_to_list(s: pd.Series):
    """Convert a Series to a JSON-friendly list (NaN -> None), rounded."""
    out = []
    for v in s.tolist():
        if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
            out.append(None)
        else:
            out.append(round(float(v), 4))
    return out
