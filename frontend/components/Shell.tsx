"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken, setToken } from "@/lib/api";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/market", label: "Market Watch", icon: "📈" },
  { href: "/builder", label: "Algorithm Builder", icon: "🧩" },
  { href: "/backtest", label: "Backtesting", icon: "⏮" },
  { href: "/paper", label: "Paper Trading", icon: "🧪" },
  { href: "/assistant", label: "AI Assistant", icon: "🤖" },
  { href: "/marketplace", label: "Marketplace", icon: "🏪" },
  { href: "/learn", label: "Learn", icon: "🎓" },
  { href: "/profile", label: "Profile", icon: "👤" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function useRequireAuth() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getToken()) router.replace("/login");
    else setReady(true);
  }, [router]);
  return ready;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api("/api/auth/me")
      .then((u) => setEmail(u.email))
      .catch(() => {});
  }, []);

  function logout() {
    setToken(null);
    router.push("/login");
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar (desktop) / topbar (mobile) */}
      <aside
        className={`lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-r border-[#1e2a3f] bg-[#0a0f1a] lg:min-h-screen lg:sticky lg:top-0`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2 no-underline">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-[#4f8ff7] text-white font-black">
              A
            </span>
            <span className="font-extrabold text-lg text-[#e6edf6]">
              AlgoTrade <span className="text-[#4f8ff7]">AI</span>
            </span>
          </Link>
          <button
            className="btn small lg:hidden"
            onClick={() => setOpen(!open)}
            aria-label="Menu"
          >
            ☰
          </button>
        </div>
        <nav
          className={`${open ? "flex" : "hidden"} lg:flex flex-col gap-1 px-3 pb-4`}
        >
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className={`px-3 py-2 rounded-lg no-underline text-[15px] ${
                pathname === n.href
                  ? "bg-[#16233c] text-white font-semibold"
                  : "text-[#b8c6da] hover:bg-[#111a2b]"
              }`}
            >
              <span className="mr-2">{n.icon}</span>
              {n.label}
            </Link>
          ))}
          <div className="mt-4 px-3 text-xs muted break-all">{email}</div>
          <button className="btn small mt-2 mx-3" onClick={logout}>
            Log out
          </button>
          <p className="px-3 mt-4 text-[11px] leading-relaxed muted">
            Paper trading only. Market data is delayed or SAMPLE — never a
            promise of returns.
          </p>
        </nav>
      </aside>
      <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 max-w-[1200px] mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
