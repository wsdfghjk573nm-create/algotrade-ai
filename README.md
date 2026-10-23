# AlgoTrade AI

An educational **algorithmic trading platform**: build strategies visually or in
Python, backtest them honestly on historical data, and practise in a
paper-trading simulator with virtual money.

> **Paper trading only.** AlgoTrade AI never connects to a live brokerage,
> never places real orders, and never promises profits. Market data is
> **delayed** (Yahoo Finance, unofficial) or clearly-labelled **SAMPLE** data.
> Nothing here is financial advice. Past performance does not guarantee
> future results.

## Contents

- [Architecture](#architecture)
- [Quick start (local, no Docker)](#quick-start-local-no-docker)
- [Run with Docker Compose (PostgreSQL)](#run-with-docker-compose-postgresql)
- [Environment variables](#environment-variables)
- [Market data providers](#market-data-providers)
- [How the backtester works](#how-the-backtester-works)
- [Python strategy sandbox — and its limits](#python-strategy-sandbox--and-its-limits)
- [AI Assistant](#ai-assistant)
- [Security notes](#security-notes)
- [Tests](#tests)
- [Deployment notes](#deployment-notes)

## Architecture

```
algotrade-ai/
├── backend/                 Python FastAPI application
│   ├── app/
│   │   ├── main.py          All API routes (auth, market, strategies,
│   │   │                    backtests, paper trading, watchlist,
│   │   │                    marketplace, assistant)
│   │   ├── engine.py        Rule-signal generation + event-driven backtester
│   │   ├── indicators.py    SMA, EMA, RSI (Wilder), MACD, Bollinger (Pandas)
│   │   ├── market.py        Yahoo Finance provider + seeded SAMPLE generator
│   │   ├── sandbox.py       AST validation + subprocess runner for Python strategies
│   │   ├── assistant.py     Built-in rule-based educational assistant
│   │   ├── seed.py          3 example strategies + marketplace examples
│   │   ├── models.py        SQLAlchemy models
│   │   ├── database.py      Engine setup (SQLite default, PostgreSQL via env)
│   │   └── security.py      bcrypt, JWT, in-memory auth rate limiter
│   ├── tests/test_api.py    66-check verification suite (unit + end-to-end)
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
├── frontend/                Next.js (App Router) + TypeScript + Tailwind v4
│   ├── app/                 12 pages + landing (see below)
│   ├── components/          Shell (nav), CandleChart, EquityChart
│   ├── lib/api.ts           API client (NEXT_PUBLIC_API_URL)
│   ├── .env.example
│   └── Dockerfile
└── docker-compose.yml       PostgreSQL + backend + frontend
```

**Pages:** Home (landing), Login, Register, Dashboard, Market Watch,
Algorithm Builder, Backtesting, Paper Trading, AI Assistant, Strategy
Marketplace, Learn, Profile, Settings.

## Quick start (local, no Docker)

Prerequisites: Python 3.11+, Node 20+.

```bash
# 1) Backend  (terminal 1)
cd backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
cp .env.example .env            # optional; defaults work out of the box
./venv/bin/uvicorn app.main:app --port 8000
# API docs: http://localhost:8000/docs

# 2) Frontend  (terminal 2)
cd frontend
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev                     # http://localhost:3000
```

Register an account in the UI. New accounts are seeded with 3 example
strategies and a ₹100,000 virtual paper-trading account.

The default database is a local SQLite file (`backend/algotrade.db`), so no
database setup is needed to run locally.

## Run with Docker Compose (PostgreSQL)

```bash
docker compose up --build
# frontend http://localhost:3000 · backend http://localhost:8000 · db :5432
```

Compose sets `DATABASE_URL=postgresql+psycopg2://algotrade:algotrade@db:5432/algotrade`
for the backend. **Change `JWT_SECRET` and the database password before any
real deployment.**

## Environment variables

Backend (`backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./algotrade.db` | SQLAlchemy URL. Use `postgresql+psycopg2://user:pass@host:5432/algotrade` for PostgreSQL. |
| `JWT_SECRET` | dev placeholder | JWT signing secret. Must be a long random string in production. |
| `JWT_EXPIRE_DAYS` | `7` | Token lifetime. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins. |
| `MARKET_CACHE_SECONDS` | `60` | In-memory market-data cache TTL. |
| `OPENAI_API_KEY` | _(empty)_ | Optional. Enables the `/api/assistant/llm` route. Off by default. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint for the optional LLM route. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model for the optional LLM route. |

Frontend (`frontend/.env.example`): `NEXT_PUBLIC_API_URL` — backend base URL
(baked in at build time, as with all `NEXT_PUBLIC_*` variables).

## Market data providers

`backend/app/market.py`:

1. **Yahoo Finance chart API** (no key). Symbols: NSE (`RELIANCE.NS`),
   BSE (`.BS`), US (`AAPL`), indices (`^NSEI`, `^GSPC`), crypto (`BTC-USD`).
   Ranges 1d/5d/1mo/3mo/6mo/1y/5y map to suitable bar intervals. Responses are
   cached in memory briefly. Yahoo's API is **unofficial and delayed** — every
   response carries `source: "live"` and the label
   *"Delayed market data — Yahoo Finance (unofficial)"*, shown in the UI.
2. **Deterministic SAMPLE generator** (seeded random walk per symbol). Used
   automatically when the live fetch fails or a symbol is unknown. Responses
   carry `source: "sample"` and the UI shows a **SAMPLE** badge. Sample data
   is never presented as real.

For production, replace the provider with a licensed market-data API behind
the same `get_ohlcv` / `get_quote` interface.

## How the backtester works

Event-driven, bar by bar (`backend/app/engine.py`):

- Signals are computed from data **up to bar t's close**; orders execute at
  **bar t+1's open** — no look-ahead bias.
- Slippage is applied adversely to every fill; commission is charged on entry
  and exit.
- Stop-loss / take-profit are checked intrabar; if both trigger on the same
  bar, the **stop-loss wins** (conservative). After a stop/take-profit exit,
  the same direction cannot re-enter until the signal changes away.
- Position sizing: % of capital, optionally capped by risk-per-trade when a
  stop-loss is set: `qty ≤ (equity × risk%) ÷ (price × stop%)`.
- Metrics: total return, CAGR, max drawdown, win rate, profit factor,
  average win/loss, expectancy, Sharpe (daily-style annualisation,
  **0% risk-free rate**, labelled approximate), plus a **buy-&-hold benchmark**
  over the same period and alpha vs that benchmark.
- Rule strategies are long-only state machines (entry conditions ANDed;
  exit conditions ANDed). Python strategies may also return −1 for shorts;
  the backtester's P&L, stop-loss and take-profit handling is
  direction-aware.

## Python strategy sandbox — and its limits

User code must define `generate_signals(df)` returning 1/0/−1 per bar.

Layers: (1) **static AST validation** — only `numpy`/`pandas` imports;
`open`, `eval`, `exec`, `__import__`, `getattr`, dunder access and IO methods
(`read_csv`, `to_csv`, …) are rejected before anything runs (also exposed as
`POST /api/strategies/validate-code`); (2) **subprocess execution** with a
restricted builtins namespace (no `open`/`eval`/`exec`), ~10s CPU limit
(`RLIMIT_CPU`), a memory cap, a minimal environment, and data passed on
stdin.

**Honest limits:** this is a *best-effort* sandbox, not a hard security
boundary. CPython-level escapes are a known hard problem; a determined
attacker with novel techniques might break out. Do not expose Python-strategy
execution to untrusted public users without an additional isolation layer
(containers/VMs per execution, seccomp, network egress off — the subprocess
itself makes no network calls by construction, but the host still can).

## AI Assistant

The assistant (`backend/app/assistant.py`) is a **built-in, rule-based
educational engine** — not a trained prediction model. It explains
indicators and concepts, generates sample Python strategies, reviews saved
backtest results in plain language (win rate, drawdown, profit factor, with
risk warnings), and **refuses** guaranteed-profit / prediction questions.

Optional: if `OPENAI_API_KEY` is set on the server, `POST /api/assistant/llm`
forwards to an OpenAI-compatible chat API with a system prompt that forbids
profit promises and predictions. It is **off by default** and the frontend
uses the built-in engine.

## Security notes

- Passwords are bcrypt-hashed; sessions are JWTs signed with `JWT_SECRET`.
- Auth endpoints have a basic **in-memory** rate limiter (30/min/IP) — use a
  gateway/Redis limiter for multi-instance production.
- All secrets come from environment variables; no real secrets are committed
  (`.env` files are excluded from the distributed zip).
- Strategy/backtest/paper/marketplace data is per-user; cross-user access
  returns 404 (verified in the test suite).
- Server-side validation on all inputs (Pydantic); CORS restricted to
  `CORS_ORIGINS`.
- Paper orders are simulated fills only — there is **no broker integration
  anywhere in this codebase**, by design.

## Tests

```bash
# start the backend on a test port with a throwaway DB, then:
cd backend
DATABASE_URL=sqlite:///./test-algotrade.db JWT_SECRET=test-secret \
  ./venv/bin/uvicorn app.main:app --port 8009 &
BASE_URL=http://127.0.0.1:8009 ./venv/bin/python tests/test_api.py
```

The suite (66 checks) covers: indicators vs hand-computed/independent
implementations, backtester no-look-ahead (signal at t fills at t+1 open),
P&L recomputed independently including both commissions, position sizing,
stop-loss price/reason, sandbox AST rejections and valid execution,
register/login/JWT, strategy CRUD + cross-user isolation, paper-trading
fill maths and overspend/oversell rejection, marketplace publish/rate/clone
with verification labels, and assistant explanations + refusal wording.

Frontend verification: `npm run build` (type-checks and produces all routes).

## Deployment notes

- **Backend:** any host that runs Python (Render, Railway, a VPS, Cloud Run…):
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, with `DATABASE_URL`
  pointing at PostgreSQL and a strong `JWT_SECRET`.
- **Frontend:** `npm run build && npm run start`, or any Next.js host. Set
  `NEXT_PUBLIC_API_URL` to the backend's public URL **before building**.
- Or simply `docker compose up --build` on one machine.
- Put both behind HTTPS in production; tighten `CORS_ORIGINS` to your domain.
- A custom domain is just DNS + your platform's domain settings; nothing in
  the code depends on the host name.
