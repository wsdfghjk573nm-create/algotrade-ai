"""SQLAlchemy models for AlgoTrade AI."""
import datetime as dt

from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer,
                        String, Text, UniqueConstraint)
from sqlalchemy.orm import relationship

from .database import Base


def _now():
    return dt.datetime.utcnow()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(120), default="")
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=_now)


class Strategy(Base):
    __tablename__ = "strategies"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(160), nullable=False)
    kind = Column(String(20), default="rules")  # rules | python
    description = Column(Text, default="")
    config = Column(Text, default="{}")  # JSON: rules model + settings
    code = Column(Text, default="")      # python strategies only
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)
    owner = relationship("User")


class BacktestRun(Base):
    __tablename__ = "backtest_runs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=True)
    strategy_name = Column(String(160), default="")
    symbol = Column(String(32), nullable=False)
    range = Column(String(8), default="1y")
    capital = Column(Float, default=100000.0)
    data_source = Column(String(16), default="sample")  # live | sample
    metrics = Column(Text, default="{}")
    equity_curve = Column(Text, default="[]")
    trades = Column(Text, default="[]")
    created_at = Column(DateTime, default=_now)


class PaperAccount(Base):
    __tablename__ = "paper_accounts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    currency = Column(String(8), default="INR")
    starting_balance = Column(Float, default=100000.0)
    cash = Column(Float, default=100000.0)
    created_at = Column(DateTime, default=_now)


class PaperOrder(Base):
    """An executed simulated fill (paper trading only — never a real order)."""
    __tablename__ = "paper_orders"
    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("paper_accounts.id"), nullable=False, index=True)
    symbol = Column(String(32), nullable=False)
    side = Column(String(4), nullable=False)  # buy | sell
    order_type = Column(String(10), default="market")  # market | limit
    qty = Column(Float, nullable=False)
    price = Column(Float, nullable=False)  # simulated fill price
    realised_pnl = Column(Float, default=0.0)
    note = Column(String(255), default="")
    created_at = Column(DateTime, default=_now)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("user_id", "symbol"),)
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    symbol = Column(String(32), nullable=False)
    created_at = Column(DateTime, default=_now)


class PublishedStrategy(Base):
    __tablename__ = "published_strategies"
    id = Column(Integer, primary_key=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    publisher_name = Column(String(120), default="")
    title = Column(String(160), nullable=False)
    description = Column(Text, default="")
    kind = Column(String(20), default="rules")
    config = Column(Text, default="{}")
    code = Column(Text, default="")
    stats = Column(Text, default="{}")  # publisher's own latest backtest stats
    stats_label = Column(String(120), default="User-submitted — not independently verified")
    is_official_example = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_now)


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (UniqueConstraint("published_id", "user_id"),)
    id = Column(Integer, primary_key=True)
    published_id = Column(Integer, ForeignKey("published_strategies.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    stars = Column(Integer, nullable=False)
    review = Column(Text, default="")
    created_at = Column(DateTime, default=_now)
