"""Seed data: 3 example rule strategies (also given to each new user as
starter copies) and official marketplace examples."""
import json

from sqlalchemy.orm import Session

from .models import PublishedStrategy, Strategy, User
from .security import hash_password

GOLDEN_CROSS = {
    "entry": [{
        "left": {"kind": "indicator", "name": "sma", "params": {"period": 50}},
        "operator": "crosses_above",
        "right": {"kind": "indicator", "name": "sma", "params": {"period": 200}},
    }],
    "exit": [{
        "left": {"kind": "indicator", "name": "sma", "params": {"period": 50}},
        "operator": "crosses_below",
        "right": {"kind": "indicator", "name": "sma", "params": {"period": 200}},
    }],
    "settings": {"stop_loss_pct": 0, "take_profit_pct": 0, "risk_per_trade_pct": 2,
                 "position_size_pct": 100, "commission_pct": 0.05, "slippage_pct": 0.05},
}

RSI_STRATEGY = {
    "entry": [{
        "left": {"kind": "indicator", "name": "rsi", "params": {"period": 14}},
        "operator": "<",
        "right": {"kind": "value", "value": 30},
    }],
    "exit": [{
        "left": {"kind": "indicator", "name": "rsi", "params": {"period": 14}},
        "operator": ">",
        "right": {"kind": "value", "value": 55},
    }],
    "settings": {"stop_loss_pct": 5, "take_profit_pct": 10, "risk_per_trade_pct": 1,
                 "position_size_pct": 50, "commission_pct": 0.05, "slippage_pct": 0.05},
}

MACD_STRATEGY = {
    "entry": [{
        "left": {"kind": "indicator", "name": "macd", "params": {"fast": 12, "slow": 26, "signal": 9}},
        "operator": "crosses_above",
        "right": {"kind": "indicator", "name": "macd_signal", "params": {"fast": 12, "slow": 26, "signal": 9}},
    }],
    "exit": [{
        "left": {"kind": "indicator", "name": "macd", "params": {"fast": 12, "slow": 26, "signal": 9}},
        "operator": "crosses_below",
        "right": {"kind": "indicator", "name": "macd_signal", "params": {"fast": 12, "slow": 26, "signal": 9}},
    }],
    "settings": {"stop_loss_pct": 4, "take_profit_pct": 0, "risk_per_trade_pct": 2,
                 "position_size_pct": 80, "commission_pct": 0.05, "slippage_pct": 0.05},
}

EXAMPLE_STRATEGIES = [
    {"name": "Golden Cross — SMA 50/200",
     "description": "The classic long-term trend rule from the spec: buy when the 50-day SMA crosses above the 200-day SMA, exit on the reverse cross.",
     "config": GOLDEN_CROSS},
    {"name": "RSI Mean Reversion — buy below 30",
     "description": "Buys when RSI(14) dips below 30 (oversold) and exits above 55, with a 5% stop-loss and 10% take-profit.",
     "config": RSI_STRATEGY},
    {"name": "MACD Signal Crossover",
     "description": "Goes long when the MACD line crosses above its signal line; exits on the reverse cross. 4% protective stop-loss.",
     "config": MACD_STRATEGY},
]


def seed_user_examples(db: Session, user: User):
    existing = db.query(Strategy).filter(Strategy.user_id == user.id).count()
    if existing:
        return
    for ex in EXAMPLE_STRATEGIES:
        db.add(Strategy(user_id=user.id, name=ex["name"], kind="rules",
                        description=ex["description"],
                        config=json.dumps(ex["config"]), code=""))
    db.commit()


def seed_marketplace(db: Session):
    if db.query(PublishedStrategy).filter(PublishedStrategy.is_official_example.is_(True)).count():
        return
    system = db.query(User).filter(User.email == "examples@algotrade.ai").first()
    if system is None:
        system = User(email="examples@algotrade.ai", name="AlgoTrade Examples",
                      password_hash=hash_password("locked-no-login-9f3k"))
        db.add(system)
        db.commit()
        db.refresh(system)
    examples = [
        ("Golden Cross — SMA 50/200 (Example)",
         "Official example strategy. Illustrative backtest statistics from a sample run — provided for learning, not a performance claim.",
         GOLDEN_CROSS, {"total_return_pct": 18.4, "max_drawdown_pct": 12.1, "win_rate_pct": 41.7,
                        "num_trades": 12, "symbol": "RELIANCE.NS", "range": "5y"}),
        ("RSI Mean Reversion (Example)",
         "Official example strategy. Illustrative statistics only — user strategies in the marketplace carry their own user-submitted stats.",
         RSI_STRATEGY, {"total_return_pct": 9.2, "max_drawdown_pct": 6.8, "win_rate_pct": 58.3,
                        "num_trades": 24, "symbol": "TCS.NS", "range": "5y"}),
    ]
    for title, desc, config, stats in examples:
        db.add(PublishedStrategy(
            strategy_id=None, user_id=system.id, publisher_name="AlgoTrade Examples",
            title=title, description=desc, kind="rules",
            config=json.dumps(config), code="", stats=json.dumps(stats),
            stats_label="Example — illustrative statistics", is_official_example=True))
    db.commit()
