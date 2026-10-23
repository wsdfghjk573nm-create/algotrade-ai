"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken } from "@/lib/api";

export default function Register() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      setToken(data.token);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm rise">
        <h1 className="text-2xl font-extrabold mb-1">Create your account</h1>
        <p className="muted text-sm mb-5">
          Free. You get 3 starter strategies and ₹1,00,000 of virtual paper-trading money.
        </p>
        <label className="label">Name</label>
        <input className="input mb-3" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <label className="label">Email</label>
        <input className="input mb-3" type="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label className="label">Password (min. 8 characters)</label>
        <input className="input mb-4" type="password" required minLength={8} value={password}
               onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        {error && <p className="neg text-sm mb-3">{error}</p>}
        <button className="btn primary w-full justify-center" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
        <p className="muted text-sm mt-4 text-center">
          Already registered? <Link href="/login" className="text-[#4f8ff7]">Log in</Link>
        </p>
        <p className="text-[11px] muted mt-4 leading-relaxed">
          Educational platform — paper trading only. Nothing here is financial
          advice and no returns are guaranteed.
        </p>
      </form>
    </main>
  );
}
