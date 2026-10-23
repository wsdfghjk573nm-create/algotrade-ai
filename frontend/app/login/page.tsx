"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm rise">
        <h1 className="text-2xl font-extrabold mb-1">Welcome back</h1>
        <p className="muted text-sm mb-5">Log in to AlgoTrade AI (paper trading only).</p>
        <label className="label">Email</label>
        <input className="input mb-3" type="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label className="label">Password</label>
        <input className="input mb-4" type="password" required value={password}
               onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <p className="neg text-sm mb-3">{error}</p>}
        <button className="btn primary w-full justify-center" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="muted text-sm mt-4 text-center">
          New here? <Link href="/register" className="text-[#4f8ff7]">Create an account</Link>
        </p>
      </form>
    </main>
  );
}
