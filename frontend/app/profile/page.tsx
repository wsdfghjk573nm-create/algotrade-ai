"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell, { useRequireAuth } from "@/components/Shell";
import { api, fmt } from "@/lib/api";

export default function Profile() {
  const ready = useRequireAuth();
  const [me, setMe] = useState<any>(null);
  const [counts, setCounts] = useState({ strategies: 0, backtests: 0, orders: 0 });
  const [account, setAccount] = useState<any>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      setMe(await api("/api/auth/me"));
      const s = await api("/api/strategies");
      const b = await api("/api/backtests");
      const o = await api("/api/paper/orders");
      const acc = await api("/api/paper/account");
      setCounts({ strategies: s.strategies.length, backtests: b.backtests.length, orders: o.orders.length });
      setAccount(acc.account);
    })().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return (
    <Shell>
      <h1 className="text-2xl font-extrabold mb-5">Profile</h1>
      <div className="card max-w-lg">
        <div className="flex items-center gap-4 mb-4">
          <span className="grid place-items-center w-14 h-14 rounded-full bg-[#16233c] text-2xl">👤</span>
          <div>
            <div className="font-bold text-lg">{me?.name || "Trader"}</div>
            <div className="muted text-sm">{me?.email}</div>
            <div className="muted text-xs">
              Member since {me?.created_at ? new Date(me.created_at + "Z").toLocaleDateString("en-IN") : "—"}
            </div>
          </div>
        </div>
        <table className="table">
          <tbody>
            <tr><td className="muted">My strategies</td><td>{counts.strategies}</td></tr>
            <tr><td className="muted">Backtests run</td><td>{counts.backtests}</td></tr>
            <tr><td className="muted">Simulated orders</td><td>{counts.orders}</td></tr>
            <tr><td className="muted">Paper account</td>
                <td>{account ? `${account.currency} · equity ${fmt(account.equity)} (virtual)` : "—"}</td></tr>
          </tbody>
        </table>
        <div className="flex gap-2 mt-4">
          <Link className="btn small" href="/settings">Account settings</Link>
          <Link className="btn small" href="/builder">My strategies</Link>
        </div>
        <p className="muted text-xs mt-4">
          This is an educational paper-trading account. Virtual balances and P&amp;L are not real money.
        </p>
      </div>
    </Shell>
  );
}
