"""AlgoTrade AI — FastAPI application.

Paper trading only. This backend never connects to a broker and never
places real orders. Market data is delayed (Yahoo Finance, unofficial)
or clearly-labelled SAMPLE data.
"""
import json
import os
import re
from datetime import datetime

import httpx
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import assistant, engine, market, seed
from .database import Base, engine as db_engine, get_db
from .indicators import bollinger, ema, macd, rsi, series_to_list, sma
from .models import (BacktestRun, PaperAccount, PaperOrder, PublishedStrategy,
                     Rating, Strategy, User, WatchlistItem)
from .sandbox import validate_code
from .security import (create_token, get_current_user, hash_password,
                       limit_auth, verify_password)

app = FastAPI(title="AlgoTrade AI", version="1.0.0",
              description="Educational algorithmic-trading platform. Paper trading only — no real orders, no guaranteed returns.")

_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

Base.metadata.create_all(bind=db_engine)
with Session(bind=db_engine) as _s:
    seed.seed_marketplace(_s)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PERIODS_PER_YEAR = {"1d": 252 * 78, "5d": 252 * 26, "1mo": 252, "3mo": 252,
                    "6mo": 252, "1y": 252, "5y": 52}
PAPER_SLIPPAGE = 0.0005  # 0.05% adverse on simulated fills


# ------------------------------------------------------------------ schemas
class RegisterIn(BaseModel):
    name: str = ""
    email: str
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class StrategyIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: str = "rules"
    description: str = ""
    config: dict = {}
    code: str = ""


class BacktestIn(BaseModel):
    strategy_id: int
    symbol: str
    range: str = "1y"
    initial_capital: float = 100000.0


class PaperOrderIn(BaseModel):
    symbol: str
    side: str  # buy | sell
    qty: float = Field(gt=0)
    order_type: str = "market"
    limit_price: float | None = None


class PaperResetIn(BaseModel):
    balance: float = Field(gt=0, le=10_000_000_000)
    currency: str = "INR"


class RunStrategyIn(BaseModel):
    strategy_id: int
    symbol: str | None = None


class PublishIn(BaseModel):
    strategy_id: int
    title: str | None = None
    description: str | None = None


class RateIn(BaseModel):
    stars: int = Field(ge=1, le=5)
    review: str = ""


class ChatIn(BaseModel):
    message: str


class ReviewIn(BaseModel):
    backtest_id: int


class ValidateCodeIn(BaseModel):
    code: str


# ------------------------------------------------------------------ helpers
def user_out(u: User):
    return {"id": u.id, "email": u.email, "name": u.name,
            "created_at": u.created_at.isoformat() if u.created_at else None}


def strategy_out(s: Strategy):
    try:
        config = json.loads(s.config or "{}")
    except json.JSONDecodeError:
        config = {}
    return {"id": s.id, "name": s.name, "kind": s.kind, "description": s.description,
            "config": config, "code": s.code or "",
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None}


def get_owned_strategy(db: Session, user: User, strategy_id: int) -> Strategy:
    s = db.query(Strategy).filter(Strategy.id == strategy_id,
                                  Strategy.user_id == user.id).first()
    if s is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return s


def get_or_create_account(db: Session, user: User) -> PaperAccount:
    acc = db.query(PaperAccount).filter(PaperAccount.user_id == user.id).first()
    if acc is None:
        acc = PaperAccount(user_id=user.id, currency="INR",
                           starting_balance=100000.0, cash=100000.0)
        db.add(acc)
        db.commit()
        db.refresh(acc)
    return acc


def compute_positions(db: Session, account_id: int):
    orders = db.query(PaperOrder).filter(PaperOrder.account_id == account_id) \
        .order_by(PaperOrder.id.asc()).all()
    positions: dict = {}
    total_realised = 0.0
    for o in orders:
        p = positions.setdefault(o.symbol, {"symbol": o.symbol, "qty": 0.0,
                                            "avg_cost": 0.0, "realised_pnl": 0.0})
        if o.side == "buy":
            new_qty = p["qty"] + o.qty
            p["avg_cost"] = (p["qty"] * p["avg_cost"] + o.qty * o.price) / new_qty if new_qty else 0.0
            p["qty"] = new_qty
        else:
            p["qty"] -= o.qty
            p["realised_pnl"] += o.realised_pnl
            total_realised += o.realised_pnl
            if abs(p["qty"]) < 1e-9:
                p["qty"] = 0.0
                p["avg_cost"] = 0.0
    return [p for p in positions.values()], total_realised, orders


# ------------------------------------------------------------------ health
@app.get("/api/health")
def health():
    return {"status": "ok", "app": "AlgoTrade AI", "paper_trading_only": True}


# ------------------------------------------------------------------ auth
@app.post("/api/auth/register", dependencies=[Depends(limit_auth)])
def register(body: RegisterIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Please enter a valid email address")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    seed.seed_user_examples(db, user)
    get_or_create_account(db, user)
    return {"token": create_token(user), "user": user_out(user)}


@app.post("/api/auth/login", dependencies=[Depends(limit_auth)])
def login(body: LoginIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"token": create_token(user), "user": user_out(user)}


@app.get("/api/auth/me")
def me(user: User = Depends(get_current_user)):
    return user_out(user)


@app.post("/api/auth/change-password")
def change_password(body: ChangePasswordIn, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ market
@app.get("/api/market/symbols")
def symbols():
    return {"symbols": market.KNOWN_SYMBOLS,
            "live_label": market.LIVE_LABEL, "sample_label": market.SAMPLE_LABEL}


@app.get("/api/market/quote/{symbol}")
async def quote(symbol: str):
    return await market.get_quote(symbol)


@app.get("/api/market/quotes")
async def quotes(symbols: str = ""):
    wanted = [s.strip() for s in symbols.split(",") if s.strip()] or \
             [s["symbol"] for s in market.KNOWN_SYMBOLS]
    out = []
    for s in wanted[:30]:
        out.append(await market.get_quote(s))
    return {"quotes": out}


@app.get("/api/market/ohlcv")
async def ohlcv(symbol: str, range: str = "1y"):
    return await market.get_ohlcv(symbol, range)


@app.get("/api/market/indicators")
async def indicators(symbol: str, range: str = "1y"):
    data = await market.get_ohlcv(symbol, range)
    bars = data["bars"]
    if not bars:
        return {**data, "indicators": {}}
    df = pd.DataFrame(bars)
    close = df["close"].astype(float)
    macd_line, signal_line, hist = macd(close)
    bb_u, bb_m, bb_l = bollinger(close)
    return {
        **data,
        "indicators": {
            "sma20": series_to_list(sma(close, 20)),
            "sma50": series_to_list(sma(close, 50)),
            "sma200": series_to_list(sma(close, 200)),
            "ema20": series_to_list(ema(close, 20)),
            "rsi14": series_to_list(rsi(close, 14)),
            "macd": series_to_list(macd_line),
            "macd_signal": series_to_list(signal_line),
            "macd_hist": series_to_list(hist),
            "bb_upper": series_to_list(bb_u),
            "bb_mid": series_to_list(bb_m),
            "bb_lower": series_to_list(bb_l),
        },
    }


# ------------------------------------------------------------------ strategies
@app.get("/api/strategies")
def list_strategies(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Strategy).filter(Strategy.user_id == user.id) \
        .order_by(Strategy.id.desc()).all()
    return {"strategies": [strategy_out(s) for s in rows]}


@app.get("/api/strategies/examples")
def strategy_examples(user: User = Depends(get_current_user)):
    return {"examples": seed.EXAMPLE_STRATEGIES}


@app.post("/api/strategies/from-example")
def from_example(body: dict, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    idx = int(body.get("index", 0))
    if idx < 0 or idx >= len(seed.EXAMPLE_STRATEGIES):
        raise HTTPException(status_code=404, detail="Example not found")
    ex = seed.EXAMPLE_STRATEGIES[idx]
    s = Strategy(user_id=user.id, name=ex["name"], kind="rules",
                 description=ex["description"], config=json.dumps(ex["config"]), code="")
    db.add(s)
    db.commit()
    db.refresh(s)
    return strategy_out(s)


@app.post("/api/strategies")
def create_strategy(body: StrategyIn, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if body.kind not in ("rules", "python"):
        raise HTTPException(status_code=422, detail="kind must be 'rules' or 'python'")
    if body.kind == "python":
        errors = validate_code(body.code)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))
    s = Strategy(user_id=user.id, name=body.name, kind=body.kind,
                 description=body.description, config=json.dumps(body.config),
                 code=body.code)
    db.add(s)
    db.commit()
    db.refresh(s)
    return strategy_out(s)


@app.get("/api/strategies/{strategy_id}")
def get_strategy(strategy_id: int, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    return strategy_out(get_owned_strategy(db, user, strategy_id))


@app.put("/api/strategies/{strategy_id}")
def update_strategy(strategy_id: int, body: StrategyIn,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = get_owned_strategy(db, user, strategy_id)
    if body.kind == "python":
        errors = validate_code(body.code)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))
    s.name, s.kind, s.description = body.name, body.kind, body.description
    s.config, s.code = json.dumps(body.config), body.code
    db.commit()
    db.refresh(s)
    return strategy_out(s)


@app.delete("/api/strategies/{strategy_id}")
def delete_strategy(strategy_id: int, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    s = get_owned_strategy(db, user, strategy_id)
    db.delete(s)
    db.commit()
    return {"ok": True}


@app.post("/api/strategies/{strategy_id}/duplicate")
def duplicate_strategy(strategy_id: int, user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    s = get_owned_strategy(db, user, strategy_id)
    copy = Strategy(user_id=user.id, name=s.name + " (copy)", kind=s.kind,
                    description=s.description, config=s.config, code=s.code)
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return strategy_out(copy)


@app.post("/api/strategies/validate-code")
def validate_python(body: ValidateCodeIn, user: User = Depends(get_current_user)):
    errors = validate_code(body.code)
    return {"valid": len(errors) == 0, "errors": errors}


# ------------------------------------------------------------------ backtests
@app.post("/api/backtests/run")
async def run_backtest(body: BacktestIn, user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    strategy = get_owned_strategy(db, user, body.strategy_id)
    data = await market.get_ohlcv(body.symbol, body.range)
    bars = data["bars"]
    if len(bars) < 30:
        raise HTTPException(status_code=400, detail="Not enough data for this symbol/range")
    df = pd.DataFrame(bars)
    try:
        config = json.loads(strategy.config or "{}")
    except json.JSONDecodeError:
        config = {}
    signals, error = engine.strategy_signals(df, strategy.kind, config, strategy.code or "")
    if error:
        raise HTTPException(status_code=400, detail=error)
    settings = dict(config.get("settings") or {})
    settings["initial_capital"] = body.initial_capital
    result = engine.run_backtest(df, signals, settings,
                                 periods_per_year=PERIODS_PER_YEAR.get(body.range, 252))
    run = BacktestRun(user_id=user.id, strategy_id=strategy.id,
                      strategy_name=strategy.name, symbol=data["symbol"],
                      range=body.range, capital=body.initial_capital,
                      data_source=data["source"],
                      metrics=json.dumps(result["metrics"]),
                      equity_curve=json.dumps(result["equity_curve"]),
                      trades=json.dumps(result["trades"]))
    db.add(run)
    db.commit()
    db.refresh(run)
    return backtest_out(run)


def backtest_out(r: BacktestRun):
    return {"id": r.id, "strategy_id": r.strategy_id, "strategy_name": r.strategy_name,
            "symbol": r.symbol, "range": r.range, "capital": r.capital,
            "data_source": r.data_source,
            "metrics": json.loads(r.metrics or "{}"),
            "equity_curve": json.loads(r.equity_curve or "[]"),
            "trades": json.loads(r.trades or "[]"),
            "created_at": r.created_at.isoformat() if r.created_at else None}


@app.get("/api/backtests")
def list_backtests(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(BacktestRun).filter(BacktestRun.user_id == user.id) \
        .order_by(BacktestRun.id.desc()).limit(50).all()
    out = []
    for r in rows:
        item = backtest_out(r)
        item["equity_curve"] = item["equity_curve"][::max(1, len(item["equity_curve"]) // 60 or 1)]
        out.append(item)
    return {"backtests": out}


@app.get("/api/backtests/{run_id}")
def get_backtest(run_id: int, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    r = db.query(BacktestRun).filter(BacktestRun.id == run_id,
                                     BacktestRun.user_id == user.id).first()
    if r is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    return backtest_out(r)


@app.delete("/api/backtests/{run_id}")
def delete_backtest(run_id: int, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    r = db.query(BacktestRun).filter(BacktestRun.id == run_id,
                                     BacktestRun.user_id == user.id).first()
    if r is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ paper trading
@app.get("/api/paper/account")
async def paper_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acc = get_or_create_account(db, user)
    positions, total_realised, _ = compute_positions(db, acc.id)
    market_value = 0.0
    pos_out = []
    for p in positions:
        if p["qty"] <= 0:
            continue
        q = await market.get_quote(p["symbol"])
        mv = p["qty"] * q["price"]
        market_value += mv
        pos_out.append({**p, "current_price": q["price"], "source": q["source"],
                        "market_value": round(mv, 2),
                        "unrealised_pnl": round((q["price"] - p["avg_cost"]) * p["qty"], 2)})
    equity = acc.cash + market_value
    return {"account": {"currency": acc.currency, "starting_balance": acc.starting_balance,
                        "cash": round(acc.cash, 2), "market_value": round(market_value, 2),
                        "equity": round(equity, 2),
                        "total_pnl": round(equity - acc.starting_balance, 2),
                        "realised_pnl": round(total_realised, 2)},
            "positions": pos_out}


@app.get("/api/paper/orders")
def paper_orders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acc = get_or_create_account(db, user)
    rows = db.query(PaperOrder).filter(PaperOrder.account_id == acc.id) \
        .order_by(PaperOrder.id.desc()).limit(200).all()
    return {"orders": [{"id": o.id, "symbol": o.symbol, "side": o.side,
                        "order_type": o.order_type, "qty": o.qty, "price": o.price,
                        "realised_pnl": o.realised_pnl, "note": o.note,
                        "created_at": o.created_at.isoformat() if o.created_at else None}
                       for o in rows]}


@app.post("/api/paper/orders")
async def place_paper_order(body: PaperOrderIn, user: User = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    side = body.side.lower()
    if side not in ("buy", "sell"):
        raise HTTPException(status_code=422, detail="side must be 'buy' or 'sell'")
    if body.order_type not in ("market", "limit"):
        raise HTTPException(status_code=422, detail="order_type must be 'market' or 'limit'")
    acc = get_or_create_account(db, user)
    symbol = body.symbol.upper().strip()
    quote = await market.get_quote(symbol)
    mkt_price = quote["price"]
    if body.order_type == "limit":
        if not body.limit_price:
            raise HTTPException(status_code=422, detail="limit_price is required for limit orders")
        crossed = mkt_price <= body.limit_price if side == "buy" else mkt_price >= body.limit_price
        if not crossed:
            raise HTTPException(
                status_code=400,
                detail=f"Limit not reached: current simulated price {mkt_price} has not crossed your limit {body.limit_price}. (Simulated immediate-or-cancel.)")
    fill = mkt_price * (1 + PAPER_SLIPPAGE) if side == "buy" else mkt_price * (1 - PAPER_SLIPPAGE)
    fill = round(fill, 4)
    positions, _, _ = compute_positions(db, acc.id)
    held = next((p["qty"] for p in positions if p["symbol"] == symbol), 0.0)
    avg_cost = next((p["avg_cost"] for p in positions if p["symbol"] == symbol), 0.0)
    realised = 0.0
    if side == "buy":
        cost = fill * body.qty
        if cost > acc.cash + 1e-9:
            raise HTTPException(status_code=400,
                                detail=f"Insufficient virtual funds: need {cost:,.2f}, have {acc.cash:,.2f}")
        acc.cash -= cost
    else:
        if body.qty > held + 1e-9:
            raise HTTPException(status_code=400,
                                detail=f"You hold {held:g} shares of {symbol}; cannot sell {body.qty:g}")
        realised = round((fill - avg_cost) * body.qty, 2)
        acc.cash += fill * body.qty
    order = PaperOrder(account_id=acc.id, symbol=symbol, side=side,
                       order_type=body.order_type, qty=body.qty, price=fill,
                       realised_pnl=realised,
                       note=f"Simulated fill ({quote['source']} data, incl. 0.05% slippage)")
    db.add(order)
    db.commit()
    db.refresh(order)
    return {"order": {"id": order.id, "symbol": symbol, "side": side, "qty": body.qty,
                      "price": fill, "data_source": quote["source"]},
            "cash": round(acc.cash, 2)}


@app.post("/api/paper/reset")
def paper_reset(body: PaperResetIn, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    acc = get_or_create_account(db, user)
    db.query(PaperOrder).filter(PaperOrder.account_id == acc.id).delete()
    acc.starting_balance = body.balance
    acc.cash = body.balance
    acc.currency = (body.currency or "INR").upper()[:8]
    db.commit()
    return {"ok": True, "cash": acc.cash, "currency": acc.currency}


@app.post("/api/paper/run-strategy")
async def paper_run_strategy(body: RunStrategyIn, user: User = Depends(get_current_user),
                             db: Session = Depends(get_db)):
    """Run a saved strategy's latest signal against the paper account.
    The resulting order (if any) is simulated and labelled as such."""
    strategy = get_owned_strategy(db, user, body.strategy_id)
    acc = get_or_create_account(db, user)
    # decide symbol: latest backtest symbol for this strategy, else RELIANCE.NS
    last_run = db.query(BacktestRun).filter(BacktestRun.user_id == user.id,
                                            BacktestRun.strategy_id == strategy.id) \
        .order_by(BacktestRun.id.desc()).first()
    symbol = (body.symbol or (last_run.symbol if last_run else "RELIANCE.NS")).upper()
    data = await market.get_ohlcv(symbol, "1y")
    df = pd.DataFrame(data["bars"])
    try:
        config = json.loads(strategy.config or "{}")
    except json.JSONDecodeError:
        config = {}
    signals, error = engine.strategy_signals(df, strategy.kind, config, strategy.code or "")
    if error:
        raise HTTPException(status_code=400, detail=error)
    latest = int(signals.iloc[-1]) if len(signals) else 0
    positions, _, _ = compute_positions(db, acc.id)
    held = next((p["qty"] for p in positions if p["symbol"] == symbol), 0.0)
    quote = await market.get_quote(symbol)
    price = quote["price"]
    note = f"Simulated algorithm order from '{strategy.name}' (signal {latest})"
    if latest == 1 and held <= 0:
        settings = config.get("settings") or {}
        size_pct = float(settings.get("position_size_pct", 50)) / 100.0
        qty = int((acc.cash * size_pct) // price)
        if qty < 1:
            return {"action": "none", "message": "Signal is long but virtual cash is too low to buy 1 share."}
        fill = round(price * (1 + PAPER_SLIPPAGE), 4)
        acc.cash -= fill * qty
        db.add(PaperOrder(account_id=acc.id, symbol=symbol, side="buy",
                          order_type="market", qty=qty, price=fill, note=note))
        db.commit()
        return {"action": "buy", "qty": qty, "price": fill, "symbol": symbol,
                "message": f"Algorithm bought {qty} × {symbol} (simulated) at {fill}"}
    if latest == 0 and held > 0:
        fill = round(price * (1 - PAPER_SLIPPAGE), 4)
        avg_cost = next((p["avg_cost"] for p in positions if p["symbol"] == symbol), 0.0)
        realised = round((fill - avg_cost) * held, 2)
        acc.cash += fill * held
        db.add(PaperOrder(account_id=acc.id, symbol=symbol, side="sell",
                          order_type="market", qty=held, price=fill,
                          realised_pnl=realised, note=note))
        db.commit()
        return {"action": "sell", "qty": held, "price": fill, "symbol": symbol,
                "message": f"Algorithm exited {held:g} × {symbol} (simulated) at {fill}"}
    return {"action": "hold",
            "message": f"Latest signal is {'long' if latest == 1 else 'flat'} and the paper account already matches it. No simulated order placed."}


# ------------------------------------------------------------------ watchlist
@app.get("/api/watchlist")
def watchlist(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id).all()
    return {"watchlist": [r.symbol for r in rows]}


@app.post("/api/watchlist")
def watchlist_add(body: dict, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    symbol = str(body.get("symbol", "")).upper().strip()
    if not symbol:
        raise HTTPException(status_code=422, detail="symbol is required")
    exists = db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id,
                                            WatchlistItem.symbol == symbol).first()
    if not exists:
        db.add(WatchlistItem(user_id=user.id, symbol=symbol))
        db.commit()
    return {"ok": True}


@app.delete("/api/watchlist/{symbol}")
def watchlist_remove(symbol: str, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id,
                                   WatchlistItem.symbol == symbol.upper()).delete()
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ marketplace
def published_out(p: PublishedStrategy, db: Session):
    ratings = db.query(Rating).filter(Rating.published_id == p.id).all()
    avg = round(sum(r.stars for r in ratings) / len(ratings), 2) if ratings else None
    return {"id": p.id, "title": p.title, "description": p.description,
            "kind": p.kind, "publisher": p.publisher_name,
            "is_official_example": bool(p.is_official_example),
            "stats": json.loads(p.stats or "{}"), "stats_label": p.stats_label,
            "avg_rating": avg, "num_ratings": len(ratings),
            "reviews": [{"stars": r.stars, "review": r.review,
                         "created_at": r.created_at.isoformat() if r.created_at else None}
                        for r in ratings],
            "created_at": p.created_at.isoformat() if p.created_at else None}


@app.get("/api/marketplace")
def marketplace_list(db: Session = Depends(get_db)):
    rows = db.query(PublishedStrategy).order_by(PublishedStrategy.id.desc()).all()
    return {"published": [published_out(p, db) for p in rows]}


@app.post("/api/marketplace/publish")
def marketplace_publish(body: PublishIn, user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    strategy = get_owned_strategy(db, user, body.strategy_id)
    last_run = db.query(BacktestRun).filter(BacktestRun.user_id == user.id,
                                            BacktestRun.strategy_id == strategy.id) \
        .order_by(BacktestRun.id.desc()).first()
    stats = {}
    if last_run:
        m = json.loads(last_run.metrics or "{}")
        stats = {k: m.get(k) for k in ("total_return_pct", "max_drawdown_pct",
                                       "win_rate_pct", "num_trades", "profit_factor")}
        stats["symbol"] = last_run.symbol
        stats["range"] = last_run.range
    pub = PublishedStrategy(
        strategy_id=strategy.id, user_id=user.id,
        publisher_name=user.name or user.email,
        title=(body.title or strategy.name)[:160],
        description=body.description if body.description is not None else strategy.description,
        kind=strategy.kind, config=strategy.config, code=strategy.code,
        stats=json.dumps(stats),
        stats_label="User-submitted — not independently verified")
    db.add(pub)
    db.commit()
    db.refresh(pub)
    return published_out(pub, db)


@app.post("/api/marketplace/{published_id}/rate")
def marketplace_rate(published_id: int, body: RateIn,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pub = db.get(PublishedStrategy, published_id)
    if pub is None:
        raise HTTPException(status_code=404, detail="Published strategy not found")
    existing = db.query(Rating).filter(Rating.published_id == published_id,
                                       Rating.user_id == user.id).first()
    if existing:
        existing.stars = body.stars
        existing.review = body.review
    else:
        db.add(Rating(published_id=published_id, user_id=user.id,
                      stars=body.stars, review=body.review))
    db.commit()
    return published_out(pub, db)


@app.post("/api/marketplace/{published_id}/clone")
def marketplace_clone(published_id: int, user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    pub = db.get(PublishedStrategy, published_id)
    if pub is None:
        raise HTTPException(status_code=404, detail="Published strategy not found")
    s = Strategy(user_id=user.id, name=pub.title + " (cloned)", kind=pub.kind,
                 description=pub.description, config=pub.config, code=pub.code)
    db.add(s)
    db.commit()
    db.refresh(s)
    return strategy_out(s)


# ------------------------------------------------------------------ assistant
@app.post("/api/assistant/chat")
def assistant_chat(body: ChatIn, user: User = Depends(get_current_user)):
    return {"reply": assistant.answer(body.message),
            "note": "Built-in educational engine — not a prediction model."}


@app.post("/api/assistant/review")
def assistant_review(body: ReviewIn, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    r = db.query(BacktestRun).filter(BacktestRun.id == body.backtest_id,
                                     BacktestRun.user_id == user.id).first()
    if r is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    metrics = json.loads(r.metrics or "{}")
    return {"reply": assistant.review_metrics(metrics, r.symbol),
            "note": "Built-in educational engine — not financial advice."}


@app.post("/api/assistant/llm")
async def assistant_llm(body: ChatIn, user: User = Depends(get_current_user)):
    """Optional: forwards to an OpenAI-compatible API ONLY if
    OPENAI_API_KEY is configured on the server. Off by default."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=404,
                            detail="LLM route is disabled. Set OPENAI_API_KEY on the server to enable it; the built-in assistant remains available.")
    base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    system = ("You are an educational trading assistant. Explain concepts simply. "
              "Never promise profits, never predict prices, always mention risk.")
    try:
        async with market.http_client(timeout=30.0) as client:
            resp = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": body.message}]})
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"]
        return {"reply": text, "note": "Answered by the configured LLM provider."}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM provider error: {exc}")
