"""Market data providers.

Primary: Yahoo Finance chart API (unofficial, no key required). Data is
delayed — it is labelled as such everywhere it is shown.

Fallback: a deterministic, seeded SAMPLE data generator. Sample data is
always labelled source="sample" in the API and "SAMPLE" in the UI. It is
never presented as real market data.
"""
import hashlib
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

def http_client(timeout: float = 8.0) -> httpx.AsyncClient:
    """httpx client that honours standard HTTPS_PROXY / SSL_CERT_FILE env
    vars when present (e.g. behind a corporate egress proxy). In a normal
    deployment with neither set, this is a plain verifying client."""
    kwargs: dict = {"timeout": timeout, "trust_env": False}
    proxy = (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
             or os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy"))
    if proxy:
        kwargs["proxy"] = proxy
    ca_file = os.environ.get("SSL_CERT_FILE")
    if ca_file and os.path.exists(ca_file):
        kwargs["verify"] = ca_file
    return httpx.AsyncClient(**kwargs)


CACHE_SECONDS = int(os.environ.get("MARKET_CACHE_SECONDS", "60"))
_cache: dict = {}
_cache_lock = threading.Lock()

LIVE_LABEL = "Delayed market data — Yahoo Finance (unofficial)"
SAMPLE_LABEL = "SAMPLE data — simulated for education, not real prices"

# range -> (yahoo_range, yahoo_interval, sample_bar_count)
RANGES = {
    "1d": ("1d", "5m", 78),
    "5d": ("5d", "15m", 130),
    "1mo": ("1mo", "1d", 22),
    "3mo": ("3mo", "1d", 66),
    "6mo": ("6mo", "1d", 132),
    "1y": ("1y", "1d", 252),
    "5y": ("5y", "1wk", 260),
}

KNOWN_SYMBOLS = [
    {"symbol": "RELIANCE.NS", "name": "Reliance Industries (NSE)"},
    {"symbol": "TCS.NS", "name": "Tata Consultancy Services (NSE)"},
    {"symbol": "INFY.NS", "name": "Infosys (NSE)"},
    {"symbol": "HDFCBANK.NS", "name": "HDFC Bank (NSE)"},
    {"symbol": "^NSEI", "name": "NIFTY 50 Index"},
    {"symbol": "AAPL", "name": "Apple Inc. (NASDAQ)"},
    {"symbol": "MSFT", "name": "Microsoft (NASDAQ)"},
    {"symbol": "GOOGL", "name": "Alphabet (NASDAQ)"},
    {"symbol": "AMZN", "name": "Amazon (NASDAQ)"},
    {"symbol": "TSLA", "name": "Tesla (NASDAQ)"},
    {"symbol": "NVDA", "name": "NVIDIA (NASDAQ)"},
    {"symbol": "^GSPC", "name": "S&P 500 Index"},
    {"symbol": "BTC-USD", "name": "Bitcoin (USD)"},
    {"symbol": "ETH-USD", "name": "Ethereum (USD)"},
]


def _seed_for(symbol: str) -> int:
    return int(hashlib.md5(symbol.upper().encode()).hexdigest()[:8], 16)


def sample_bars(symbol: str, range_: str, count: int | None = None) -> list:
    """Deterministic seeded random-walk OHLCV bars (clearly SAMPLE data)."""
    yahoo_range, interval, default_count = RANGES.get(range_, RANGES["1y"])
    n = count or default_count
    rng = np.random.RandomState(_seed_for(symbol))
    base = 40.0 + (rng.rand() * 460.0)  # stable pseudo base price per symbol
    drift = (rng.rand() - 0.46) * 0.0012
    vol = 0.008 + rng.rand() * 0.02
    closes = [base]
    for _ in range(n - 1):
        shock = rng.randn() * vol
        closes.append(max(1.0, closes[-1] * (1.0 + drift + shock)))
    closes = np.array(closes)
    opens = np.empty_like(closes)
    opens[0] = closes[0] * (1 - vol / 3)
    opens[1:] = closes[:-1] * (1 + rng.randn(n - 1) * vol * 0.3)
    highs = np.maximum(opens, closes) * (1 + np.abs(rng.randn(n)) * vol * 0.4)
    lows = np.minimum(opens, closes) * (1 - np.abs(rng.randn(n)) * vol * 0.4)
    volumes = (rng.rand(n) * 900_000 + 100_000).astype(int)

    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    times = []
    if interval in ("5m", "15m"):
        step = timedelta(minutes=5 if interval == "5m" else 15)
        start = now - step * (n - 1)
        times = [start + step * i for i in range(n)]
    elif interval == "1wk":
        times = [now - timedelta(weeks=(n - 1 - i)) for i in range(n)]
    else:
        # business days ending today
        days = []
        d = now.date()
        while len(days) < n:
            if d.weekday() < 5:
                days.append(d)
            d -= timedelta(days=1)
        days.reverse()
        times = [datetime(d.year, d.month, d.day, tzinfo=timezone.utc) for d in days]

    bars = []
    for i in range(n):
        bars.append({
            "time": int(times[i].timestamp()),
            "open": round(float(opens[i]), 2),
            "high": round(float(highs[i]), 2),
            "low": round(float(lows[i]), 2),
            "close": round(float(closes[i]), 2),
            "volume": int(volumes[i]),
        })
    return bars


async def fetch_yahoo(symbol: str, range_: str):
    """Fetch bars from Yahoo Finance; returns (bars, currency) or None."""
    yahoo_range, interval, _ = RANGES.get(range_, RANGES["1y"])
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {"range": yahoo_range, "interval": interval, "includePrePost": "false"}
    headers = {"User-Agent": "Mozilla/5.0 (compatible; AlgoTradeAI/1.0)"}
    try:
        async with http_client(timeout=8.0) as client:
            resp = await client.get(url, params=params, headers=headers)
        if resp.status_code != 200:
            return None
        data = resp.json()
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            return None
        result = result[0]
        timestamps = result.get("timestamp") or []
        quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
        opens, highs, lows, closes, vols = (
            quote.get("open") or [], quote.get("high") or [], quote.get("low") or [],
            quote.get("close") or [], quote.get("volume") or [],
        )
        bars = []
        for i, ts in enumerate(timestamps):
            if i >= len(closes) or closes[i] is None:
                continue
            o = opens[i] if i < len(opens) and opens[i] is not None else closes[i]
            h = highs[i] if i < len(highs) and highs[i] is not None else closes[i]
            lo = lows[i] if i < len(lows) and lows[i] is not None else closes[i]
            v = vols[i] if i < len(vols) and vols[i] is not None else 0
            bars.append({
                "time": int(ts),
                "open": round(float(o), 2), "high": round(float(h), 2),
                "low": round(float(lo), 2), "close": round(float(closes[i]), 2),
                "volume": int(v),
            })
        if len(bars) < 5:
            return None
        currency = (result.get("meta") or {}).get("currency", "")
        return bars, currency
    except Exception:
        return None


async def get_ohlcv(symbol: str, range_: str = "1y") -> dict:
    symbol = symbol.upper().strip()
    range_ = range_ if range_ in RANGES else "1y"
    key = (symbol, range_)
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]

    fetched = await fetch_yahoo(symbol, range_)
    if fetched:
        bars, currency = fetched
        result = {
            "symbol": symbol, "range": range_,
            "interval": RANGES[range_][1],
            "source": "live", "source_label": LIVE_LABEL,
            "currency": currency, "bars": bars,
        }
    else:
        result = {
            "symbol": symbol, "range": range_,
            "interval": RANGES[range_][1],
            "source": "sample", "source_label": SAMPLE_LABEL,
            "currency": "", "bars": sample_bars(symbol, range_),
        }
    with _cache_lock:
        _cache[key] = (now, result)
    return result


async def get_quote(symbol: str) -> dict:
    data = await get_ohlcv(symbol, "5d")
    bars = data["bars"]
    last = bars[-1]
    prev = bars[-2] if len(bars) > 1 else last
    change = last["close"] - prev["close"]
    change_pct = (change / prev["close"] * 100.0) if prev["close"] else 0.0
    return {
        "symbol": data["symbol"],
        "price": last["close"],
        "change": round(change, 2),
        "change_pct": round(change_pct, 2),
        "source": data["source"],
        "source_label": data["source_label"],
        "currency": data.get("currency", ""),
        "spark": [b["close"] for b in bars[-30:]],
    }
