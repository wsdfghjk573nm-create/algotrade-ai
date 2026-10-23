"use client";

import { useEffect, useRef, useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";
import { api } from "@/lib/api";

interface Msg { role: "user" | "assistant"; text: string }

const SUGGESTIONS = [
  "What is RSI?",
  "Explain MACD simply",
  "Show me a golden cross strategy",
  "What is look-ahead bias?",
  "How should I manage risk?",
  "What is a good profit factor?",
];

export default function AssistantPage() {
  const ready = useRequireAuth();
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hello! I am the built-in educational assistant — a rule-based explainer, not a prediction model. Ask me about indicators (RSI, MACD, Bollinger Bands), backtesting honesty, risk management, or ask for sample strategy code. Tip: on the Backtesting page you can ask me to review a real backtest result.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setMessages((m) => [...m, { role: "user", text: msg }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api("/api/assistant/chat", {
        method: "POST", body: JSON.stringify({ message: msg }),
      });
      setMessages((m) => [...m, { role: "assistant", text: r.reply }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", text: "Sorry — " + e.message }]);
    }
    setBusy(false);
  }

  if (!ready) return null;
  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-1">AI Trading Assistant</h1>
      <p className="muted text-sm mb-5">
        Educational only. This assistant explains concepts and reviews backtests —
        it <b>cannot</b> predict the market or guarantee profits, and it will tell you so if asked.
      </p>

      <div className="card">
        <div className="flex flex-col gap-3 max-h-[55vh] overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i}
                 className={`rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap max-w-[85%] ${
                   m.role === "user"
                     ? "self-end bg-[#16233c]"
                     : "self-start bg-[#0a0f1a] border border-[#1e2a3f]"
                 }`}>
              {m.text}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn small" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
        <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="input" placeholder="Ask about an indicator, risk, or strategy code…"
                 value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn primary" disabled={busy}>{busy ? "…" : "Send"}</button>
        </form>
      </div>
      <p className="muted text-xs mt-3">
        Built-in rule-based engine. If the server admin enables an LLM provider key, an optional
        LLM route exists in the API — it is off by default.
      </p>
    </Shell>
  );
}
