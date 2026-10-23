export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("at_token");
}

export function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem("at_token", t);
  else localStorage.removeItem("at_token");
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    throw new Error(data?.detail || `Request failed (${res.status})`);
  }
  return data as T;
}

export function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function timeLabel(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Strategy {
  id: number;
  name: string;
  kind: "rules" | "python";
  description: string;
  config: any;
  code: string;
  created_at: string | null;
  updated_at: string | null;
}
