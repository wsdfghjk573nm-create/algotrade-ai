"use client";

import { useEffect, useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";
import { api } from "@/lib/api";

export default function Settings() {
  const ready = useRequireAuth();
  const [balance, setBalance] = useState(100000);
  const [currency, setCurrency] = useState("INR");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!ready) return;
    api("/api/paper/account").then((d) => {
      setBalance(d.account.starting_balance);
      setCurrency(d.account.currency);
    }).catch(() => {});
  }, [ready]);

  async function resetPaper(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setMsg("");
    try {
      await api("/api/paper/reset", {
        method: "POST", body: JSON.stringify({ balance, currency }),
      });
      setMsg("Paper account reset. All simulated positions and history were cleared.");
    } catch (e: any) { setErr(e.message); }
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setMsg("");
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      setMsg("Password changed.");
      setCurrentPw(""); setNewPw("");
    } catch (e: any) { setErr(e.message); }
  }

  if (!ready) return null;
  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-5">Settings</h1>
      {msg && <p className="pos text-sm mb-3">{msg}</p>}
      {err && <p className="neg text-sm mb-3">{err}</p>}

      <form onSubmit={resetPaper} className="card max-w-lg mb-6">
        <h2 className="font-bold mb-1">Paper trading account</h2>
        <p className="muted text-sm mb-4">
          Resetting clears all simulated positions and trade history and restarts
          with the virtual balance below. This never touches real money.
        </p>
        <label className="label">Starting virtual balance</label>
        <input className="input mb-3" type="number" min={1} value={balance}
               onChange={(e) => setBalance(Number(e.target.value))} />
        <label className="label">Currency</label>
        <select className="select mb-4" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="INR">INR (₹)</option>
          <option value="USD">USD ($)</option>
        </select>
        <button className="btn red">Reset paper account</button>
      </form>

      <form onSubmit={changePw} className="card max-w-lg">
        <h2 className="font-bold mb-4">Change password</h2>
        <label className="label">Current password</label>
        <input className="input mb-3" type="password" value={currentPw}
               onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" />
        <label className="label">New password (min. 8 characters)</label>
        <input className="input mb-4" type="password" minLength={8} value={newPw}
               onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        <button className="btn primary">Change password</button>
      </form>

      <div className="card max-w-lg mt-6">
        <h2 className="font-bold mb-1">Data &amp; safety notes</h2>
        <p className="muted text-sm leading-relaxed">
          API keys and secrets live only on the server — never in this frontend.
          Market data shown here is delayed (Yahoo Finance, unofficial) or SAMPLE.
          This app cannot place real orders and is not connected to any broker.
        </p>
      </div>
    </Shell>
  );
}
