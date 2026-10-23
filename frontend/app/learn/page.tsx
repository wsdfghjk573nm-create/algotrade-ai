"use client";

import { useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";

const LESSONS = [
  {
    title: "1 · What algorithmic trading really is",
    body: "An algorithm is just a set of explicit rules: when to enter, when to exit, and how much to trade. Code applies those rules consistently — it removes hesitation, but it does not remove risk, and it cannot make a bad strategy good. The advantage of algorithms is discipline and testability, not magic.",
  },
  {
    title: "2 · Reading a candlestick chart",
    body: "Each candle summarises one period: open, high, low, close. Green means the close was above the open; red means below. The wicks show how far price travelled. Single-candle patterns are weak signals — experienced traders weigh trend, volume and location (support/resistance) far more.",
  },
  {
    title: "3 · Trend indicators: SMA, EMA and MACD",
    body: "Moving averages smooth price into a trend line. The 50/200 SMA 'golden cross' is a slow, long-term trend filter — it will always be late, by design. MACD compares two EMAs to show momentum shifts. All trend indicators lag; their job is confirmation, not prediction, and they whipsaw in sideways markets.",
  },
  {
    title: "4 · Momentum: RSI and Bollinger Bands",
    body: "RSI(14) measures the speed of recent gains vs losses on a 0–100 scale. 'Overbought' above 70 does not mean 'sell now' — strong trends pin RSI high for weeks. Bollinger Bands wrap price in a volatility envelope (±2 standard deviations around a 20-period average): narrow bands mean quiet markets, wide bands mean wild ones.",
  },
  {
    title: "5 · Backtesting without fooling yourself",
    body: "The three classic self-deceptions: (1) Look-ahead bias — using information you could not have had (this app executes at the next bar's open). (2) Ignoring costs — commissions and slippage quietly eat small edges. (3) Overfitting — tuning rules until they fit one history perfectly; they then fail on new data. Demand many trades, several symbols and several periods.",
  },
  {
    title: "6 · The metrics that matter",
    body: "Total return alone is nearly meaningless. Read it with: maximum drawdown (the worst peak-to-trough pain), win rate AND average win vs average loss (a 40% win rate can be profitable if wins are 3× losses), profit factor (gross profit ÷ gross loss), expectancy per trade, and a benchmark comparison (did you beat simply buying and holding?).",
  },
  {
    title: "7 · Risk management and position sizing",
    body: "Professionals start from risk, not returns. A common rule: risk 0.5–2% of capital per trade. Position size = (capital × risk%) ÷ (entry − stop distance). Stop-losses are seatbelts: decide the exit before entering. And size so that a string of 8–10 losses — which will happen — cannot cripple the account.",
  },
  {
    title: "8 · Paper trading and the road beyond",
    body: "Paper trading checks behaviour: does the strategy take the trades you expected, at sensible times, with tolerable drawdowns? Run it for weeks, not days. Even then, real markets add emotion, partial fills and outages that no simulator fully reproduces. Treat live trading as a separate, advanced step requiring far more review — this platform deliberately stops at paper trading.",
  },
];

export default function Learn() {
  const ready = useRequireAuth();
  const [open, setOpen] = useState(0);
  if (!ready) return null;
  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-1">Learn Algorithmic Trading</h1>
      <p className="muted text-sm mb-5">Eight short lessons. Honest first: no lesson here — or anywhere — can teach you to predict the market.</p>
      <div className="flex flex-col gap-3">
        {LESSONS.map((l, i) => (
          <div key={l.title} className="card">
            <button className="w-full text-left font-bold flex justify-between" onClick={() => setOpen(open === i ? -1 : i)}>
              {l.title}<span>{open === i ? "−" : "+"}</span>
            </button>
            {open === i && <p className="muted text-sm leading-relaxed mt-2">{l.body}</p>}
          </div>
        ))}
      </div>
      <div className="card mt-6">
        <h2 className="font-bold mb-1">Keep learning</h2>
        <p className="muted text-sm leading-relaxed">
          Use the AI Assistant page for plain-language explanations of any term on this page, then
          test every idea in the Backtester — and judge it by drawdown and expectancy, not hope.
        </p>
      </div>
    </Shell>
  );
}
