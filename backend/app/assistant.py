"""Built-in educational assistant (rule-based — NOT a trained prediction
model). It explains concepts, generates sample strategy code, and reviews
backtest results. It refuses guaranteed-profit / market-prediction
questions. An optional OpenAI-compatible route exists in main.py, off by
default.
"""

TOPICS = {
    "rsi": ("RSI (Relative Strength Index)",
            "RSI is a momentum indicator that runs from 0 to 100. It compares recent gains to recent losses over (usually) 14 bars. "
            "Readings above 70 are often called 'overbought' and below 30 'oversold', but those are not automatic sell/buy signals — "
            "in a strong trend RSI can stay overbought for a long time. In this app: RSI(14) is computed with Wilder's smoothing."),
    "macd": ("MACD",
             "MACD = EMA(12) − EMA(26) of price. Its 'signal line' is EMA(9) of the MACD line, and the histogram is MACD minus signal. "
             "Traders watch for the MACD line crossing the signal line as a trend/momentum change clue. MACD lags price — it confirms trends rather than predicting them."),
    "moving average": ("Moving Averages (SMA / EMA)",
                       "An SMA is the simple average of the last N closes; an EMA weights recent prices more, so it reacts faster. "
                       "A common long-term trend rule: when the 50-period average crosses above the 200-period average ('golden cross'), "
                       "trend followers treat it as bullish; the reverse ('death cross') as bearish. Crossovers are lagging and can whipsaw in sideways markets."),
    "bollinger": ("Bollinger Bands",
                  "Bollinger Bands are a 20-period SMA plus/minus 2 standard deviations. Bands widen when volatility rises and narrow when it falls. "
                  "Price touching a band is NOT by itself a reversal signal — in trends, price can 'walk the band' for many bars."),
    "drawdown": ("Maximum Drawdown",
                 "Maximum drawdown is the largest peak-to-trough fall in a strategy's equity curve. It answers: 'what was the worst ride along the way?' "
                 "A strategy can be profitable overall and still have a painful drawdown. Always compare returns together with drawdown."),
    "sharpe": ("Sharpe Ratio",
               "Sharpe ratio = average return divided by the volatility of returns (this app uses a 0% risk-free rate and annualises approximately). "
               "Higher is smoother per unit of risk. It says nothing about whether returns will continue, and it can be inflated by short test periods."),
    "slippage": ("Slippage",
                 "Slippage is the difference between the price you expected and the price you actually got, caused by market movement and liquidity. "
                 "Backtests here add slippage to every fill (against you), because real trading rarely fills at the exact signal price."),
    "look-ahead": ("Look-ahead Bias",
                   "Look-ahead bias means a backtest secretly uses information that was not available at the time (for example, executing at the same close that generated the signal). "
                   "It makes results look far better than reality. This app executes signals at the NEXT bar's open to avoid it."),
    "backtest": ("Backtesting",
                 "Backtesting runs a strategy's rules over historical data. A good backtest includes commissions, slippage, and enough trades to be meaningful, "
                 "and avoids look-ahead bias and overfitting (tuning rules until they fit the past perfectly). Past performance does not guarantee future results."),
    "risk": ("Risk Management",
             "Core risk rules: (1) risk only a small % of capital per trade (many use 0.5–2%); (2) decide position size from your stop distance, not gut feel; "
             "(3) use stop-losses and respect them; (4) diversify instead of betting everything on one symbol; (5) judge a strategy by drawdown as well as profit."),
    "stop loss": ("Stop-Loss & Take-Profit",
                  "A stop-loss exits a trade when price moves against you by a set amount, capping the loss on that trade. A take-profit exits after a set gain. "
                  "In this app's backtester, if both would trigger inside the same bar, the stop-loss is assumed to happen first (conservative)."),
    "profit factor": ("Profit Factor & Expectancy",
                      "Profit factor = gross profits ÷ gross losses. Above 1.0 means the backtest made more than it lost; many traders look for 1.3+ with enough trades. "
                      "Expectancy = average profit/loss per trade — the single best summary of whether a strategy made money per trade in the test period."),
    "paper trading": ("Paper Trading",
                      "Paper trading is simulated trading with virtual money — no real orders, no real risk. Use it to check that a strategy behaves as expected "
                      "('does it take the trades I think it does?') before ever considering real money. This entire app is paper-trading only."),
    "candle": ("Candlestick Charts",
               "Each candle shows open, high, low and close for its period. Green = close above open, red = close below open. The thin lines (wicks) show the extremes. "
               "Single-candle 'patterns' are weak evidence; context (trend, volume, support/resistance) matters more."),
    "algorithm": ("Algorithmic Trading",
                  "Algorithmic trading means writing explicit rules — indicators, conditions, exits, position sizing — and letting a program apply them consistently. "
                  "The hard parts are not the code: they are honest backtesting, risk control, and not overfitting rules to one period of history."),
}

SNIPPETS = {
    "golden cross": ("Golden Cross (SMA 50/200)",
                     "def generate_signals(df):\n"
                     "    fast = df['close'].rolling(50).mean()\n"
                     "    slow = df['close'].rolling(200).mean()\n"
                     "    sig = (fast > slow).astype(int)\n"
                     "    return sig.fillna(0)\n"),
    "rsi": ("RSI Mean Reversion (buy below 30, exit above 55)",
            "def generate_signals(df):\n"
            "    delta = df['close'].diff()\n"
            "    gain = delta.clip(lower=0).ewm(alpha=1/14, adjust=False).mean()\n"
            "    loss = (-delta.clip(upper=0)).ewm(alpha=1/14, adjust=False).mean()\n"
            "    rsi = 100 - 100 / (1 + gain / loss)\n"
            "    sig = pd.Series(0, index=df.index)\n"
            "    in_pos = False\n"
            "    for i in range(len(df)):\n"
            "        if not in_pos and rsi.iloc[i] < 30:\n"
            "            in_pos = True\n"
            "        elif in_pos and rsi.iloc[i] > 55:\n"
            "            in_pos = False\n"
            "        sig.iloc[i] = 1 if in_pos else 0\n"
            "    return sig\n"),
    "macd": ("MACD Crossover",
             "def generate_signals(df):\n"
             "    macd = df['close'].ewm(span=12, adjust=False).mean() - df['close'].ewm(span=26, adjust=False).mean()\n"
             "    signal = macd.ewm(span=9, adjust=False).mean()\n"
             "    return (macd > signal).astype(int).fillna(0)\n"),
    "bollinger": ("Bollinger Band Breakout",
                  "def generate_signals(df):\n"
                  "    mid = df['close'].rolling(20).mean()\n"
                  "    std = df['close'].rolling(20).std()\n"
                  "    upper = mid + 2 * std\n"
                  "    lower = mid - 2 * std\n"
                  "    sig = pd.Series(0, index=df.index)\n"
                  "    in_pos = False\n"
                  "    for i in range(len(df)):\n"
                  "        if not in_pos and df['close'].iloc[i] > upper.iloc[i]:\n"
                  "            in_pos = True\n"
                  "        elif in_pos and df['close'].iloc[i] < mid.iloc[i]:\n"
                  "            in_pos = False\n"
                  "        sig.iloc[i] = 1 if in_pos else 0\n"
                  "    return sig.fillna(0)\n"),
}

REFUSAL_PHRASES = [
    "guarantee", "guaranteed", "predict", "prediction", "will go up",
    "will rise", "will fall", "sure shot", "sureshot", "sure-shot",
    "double my money", "100% profit", "can't lose", "cannot lose",
    "get rich", "make me rich", "certain profit", "risk-free profit",
    "risk free profit", "which stock will", "what will happen",
]

REFUSAL = (
    "I can't do that — and you should be careful with anyone or any tool that claims it can. "
    "No person or AI can predict the market with certainty or guarantee profits; markets are uncertain by nature. "
    "What I CAN do: explain how strategies and indicators work, help you backtest an idea honestly (with costs and slippage), "
    "and show you how to measure its risk — so your decisions are based on evidence, not promises."
)

GREETING = (
    "I am the built-in educational assistant (a rule-based explainer, not a prediction model). "
    "Ask me about RSI, MACD, moving averages, Bollinger Bands, drawdown, Sharpe, slippage, look-ahead bias, "
    "risk management, or say 'show me a golden cross strategy' for sample code. "
    "You can also run a backtest and ask me to review it from the Backtesting page."
)


def review_metrics(m: dict, symbol: str = "") -> str:
    lines = [f"Backtest review{f' for {symbol}' if symbol else ''} — educational commentary, not advice:"]
    n = m.get("num_trades", 0)
    if n == 0:
        lines.append("• The strategy took no trades in this period, so there is nothing to judge. Try a longer range or different conditions.")
        return "\n".join(lines)
    tr = m.get("total_return_pct", 0)
    lines.append(f"• Total return: {tr:.2f}% over the test (benchmark buy & hold: {m.get('benchmark_return_pct', 0):.2f}%, alpha {m.get('alpha_pct', 0):+.2f}%).")
    dd = m.get("max_drawdown_pct", 0)
    lines.append(f"• Worst peak-to-trough fall (max drawdown): {dd:.2f}% — judge the return against this pain.")
    if dd and tr and dd > abs(tr):
        lines.append("• Caution: the drawdown is larger than the total return — the ride was rougher than the reward.")
    lines.append(f"• Win rate: {m.get('win_rate_pct', 0):.1f}% across {n} trades. Win rate alone means little — a strategy can win often and still lose money if losses are bigger than wins.")
    pf = m.get("profit_factor")
    if pf is None:
        lines.append("• Profit factor could not be computed (no losing or no winning trades).")
    else:
        verdict = "healthy in this sample" if pf >= 1.3 else ("barely above break-even" if pf >= 1.0 else "below 1 — it lost more than it made in this sample")
        lines.append(f"• Profit factor: {pf} — {verdict}.")
    if n < 10:
        lines.append(f"• Only {n} trades — far too few to trust. Treat this as a smoke test, not evidence.")
    if m.get("sharpe") is not None:
        lines.append(f"• Sharpe (approx, 0% risk-free): {m['sharpe']}. Useful for comparing strategies on the same data, not a promise.")
    lines.append("• Reminder: this is one historical period, with costs and slippage included. Past performance does not guarantee future results — test other periods and symbols before drawing conclusions.")
    return "\n".join(lines)


def answer(message: str) -> str:
    msg = (message or "").strip()
    low = msg.lower()
    if not low:
        return GREETING
    if any(p in low for p in REFUSAL_PHRASES):
        return REFUSAL
    if "code" in low or "strategy" in low or "show me" in low or "example" in low or "write" in low:
        for key, (title, code) in SNIPPETS.items():
            if key in low or (key == "golden cross" and "golden" in low) or (key == "rsi" and "rsi" in low):
                return (f"Here is a sample Python strategy — {title}. It defines generate_signals(df) "
                        f"returning 1 (be long), 0 (stay flat) per bar. Paste it into the Algorithm Builder's Code tab and backtest it — "
                        f"and always check the drawdown, not just the return.\n\n```python\n{code}```")
        return ("I can generate sample code for: a golden cross (SMA 50/200), RSI mean reversion, a MACD crossover, "
                "or a Bollinger Band breakout. Which one? Say e.g. 'show me a golden cross strategy'.")
    for key, (title, text) in TOPICS.items():
        if key in low:
            return f"{title}: {text}"
    if "review" in low or "my backtest" in low:
        return ("To review a backtest, open the Backtesting page, run (or select) a result, and use the 'Review with assistant' button — "
                "I'll comment on its win rate, drawdown and profit factor in plain language, with the risks spelled out.")
    if "hello" in low or "hi" == low[:2]:
        return GREETING
    return ("I can explain: RSI, MACD, moving averages, Bollinger Bands, drawdown, Sharpe ratio, slippage, look-ahead bias, "
            "backtesting, stop-losses, profit factor, paper trading, candlesticks and risk management — or generate sample strategy code "
            "(try 'show me a golden cross strategy'). I cannot predict prices or guarantee profits.")
