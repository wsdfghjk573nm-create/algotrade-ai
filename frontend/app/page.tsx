import Link from "next/link";

const FEATURES = [
  {
    icon: "🧩",
    title: "Visual Algorithm Builder",
    text: "Build strategies from condition blocks — RSI, MACD, moving averages, Bollinger Bands — with entry/exit rules, stop-loss, take-profit and position sizing. No coding needed.",
  },
  {
    icon: "🐍",
    title: "Python Strategies",
    text: "Prefer code? Write generate_signals(df) in Python with NumPy and Pandas. Code is checked statically and run in a restricted sandbox.",
  },
  {
    icon: "⏮",
    title: "Honest Backtesting",
    text: "Bar-by-bar backtests with next-bar-open execution (no look-ahead bias), commissions, slippage, stop-loss/take-profit, drawdown, win rate, profit factor and a buy-&-hold benchmark.",
  },
  {
    icon: "🧪",
    title: "Paper Trading",
    text: "Practise with ₹1,00,000 of virtual money. Simulated orders, positions and P&L — never real money, never a live broker.",
  },
  {
    icon: "🤖",
    title: "AI Learning Assistant",
    text: "A built-in educational assistant that explains indicators and risk in plain language and reviews your backtests. It never predicts prices or promises profits.",
  },
  {
    icon: "🏪",
    title: "Strategy Marketplace",
    text: "Publish your strategies, learn from community examples, rate and clone them. User-submitted statistics are always labelled as not independently verified.",
  },
];

export default function Home() {
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <header className="flex items-center justify-between mb-12">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-[#4f8ff7] text-white font-black">A</span>
          <span className="font-extrabold text-lg">AlgoTrade <span className="text-[#4f8ff7]">AI</span></span>
        </div>
        <div className="flex gap-2">
          <Link className="btn" href="/login">Log in</Link>
          <Link className="btn primary" href="/register">Start free</Link>
        </div>
      </header>

      <section className="text-center rise">
        <h1 className="text-4xl sm:text-5xl font-black leading-tight">
          Learn algorithmic trading<br />
          <span className="text-[#16c784]">without risking</span>{" "}
          <span className="text-[#ea3943]">real money</span>
        </h1>
        <p className="muted mt-4 max-w-2xl mx-auto">
          Build trading algorithms visually or in Python, backtest them honestly
          on historical data — with costs, slippage and no look-ahead bias — then
          practise in a paper-trading simulator.
        </p>
        <div className="mt-6 flex gap-3 justify-center flex-wrap">
          <Link className="btn primary" href="/register">Create a free account</Link>
          <Link className="btn" href="/login">I already have an account</Link>
        </div>
        <p className="text-xs muted mt-4">
          Market data is delayed (Yahoo Finance, unofficial) or clearly-labelled
          SAMPLE data. This is an education platform: paper trading only.
        </p>
      </section>

      <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-14">
        {FEATURES.map((f) => (
          <div key={f.title} className="card rise">
            <div className="text-3xl mb-2">{f.icon}</div>
            <h3 className="font-bold mb-1">{f.title}</h3>
            <p className="muted text-sm leading-relaxed">{f.text}</p>
          </div>
        ))}
      </section>

      <section className="card mt-10 rise">
        <h2 className="font-bold text-lg mb-2">How it works</h2>
        <ol className="muted text-sm leading-relaxed list-decimal ml-5 space-y-1">
          <li>Create a strategy in the Algorithm Builder (blocks or Python).</li>
          <li>Backtest it on historical data and read the drawdown, not just the return.</li>
          <li>Ask the AI Assistant to review the result in plain language.</li>
          <li>Run it in Paper Trading with virtual money and watch it behave.</li>
          <li>Share it in the Marketplace if you want feedback.</li>
        </ol>
      </section>

      <section className="mt-8 rounded-xl border border-[#7f1d1d] bg-[#2a0d10] p-5 rise">
        <h2 className="font-bold text-[#f87171] mb-1">⚠ Risk disclosure</h2>
        <p className="text-sm text-[#fca5a5] leading-relaxed">
          Trading involves substantial risk of loss. Nothing on this platform is
          financial advice, and no strategy here — backtested or published — can
          guarantee profits or predict the market. Past performance does not
          guarantee future results. AlgoTrade AI is for education: it never
          connects to a live brokerage and never places real orders.
        </p>
      </section>

      <footer className="text-center muted text-xs mt-10">
        AlgoTrade AI · Paper trading only · Delayed/SAMPLE market data · Learn before you ever trade.
      </footer>
    </main>
  );
}
