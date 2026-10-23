'use strict';

/**
 * AlgoTrade AI — interactive GitHub Pages demo.
 * Everything runs in the browser on generated SAMPLE data. There is no
 * server, no database and no network call: accounts, saved strategies and
 * the real backtesting server exist only in the full version (see the
 * "Full Version" section of the page). Pure calculation functions are
 * exported at the bottom so they can be unit-tested in Node.
 */

/* ---------------- Seeded PRNG + sample OHLCV generator ----------------
 * Mirrors backend/app/market.py: a seeded random walk with a per-symbol
 * base price, small drift and daily volatility; opens follow the previous
 * close, highs/lows bracket open/close, volumes are pseudo-random. */

function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng) {
  // Box–Muller, using the seeded PRNG.
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

const SAMPLE_SYMBOLS = {
  'RELIANCE-DEMO': { label: 'RELIANCE (Sample)', base: 2450 },
  'TCS-DEMO': { label: 'TCS (Sample)', base: 3900 },
  'BTC-DEMO': { label: 'BTC (Sample)', base: 67000 },
};

function businessDayLabels(n) {
  const days = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (days.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) days.unshift(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  return days;
}

function generateSampleBars(symbol, seed, count) {
  const n = count || 260;
  const cfg = SAMPLE_SYMBOLS[symbol] || { base: 500 };
  const rng = mulberry32((seedFromString(symbol) ^ (seed >>> 0)) >>> 0);
  const drift = (rng() - 0.46) * 0.0012;
  const vol = 0.008 + rng() * 0.02;
  const closes = [cfg.base * (0.9 + rng() * 0.2)];
  for (let i = 1; i < n; i++) {
    const shock = randn(rng) * vol;
    closes.push(Math.max(1, closes[i - 1] * (1 + drift + shock)));
  }
  const labels = businessDayLabels(n);
  const bars = [];
  for (let i = 0; i < n; i++) {
    const open = i === 0 ? closes[0] * (1 - vol / 3) : closes[i - 1] * (1 + randn(rng) * vol * 0.3);
    const high = Math.max(open, closes[i]) * (1 + Math.abs(randn(rng)) * vol * 0.4);
    const low = Math.min(open, closes[i]) * (1 - Math.abs(randn(rng)) * vol * 0.4);
    bars.push({
      date: labels[i],
      open: round2(open), high: round2(high), low: round2(low), close: round2(closes[i]),
      volume: Math.floor(rng() * 900000 + 100000),
    });
  }
  return bars;
}

function round2(x) { return Math.round(x * 100) / 100; }

/* ---------------- Indicators (match backend/app/indicators.py) ---------------- */

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seedSum = 0;
  for (let i = 0; i < period; i++) seedSum += values[i];
  let prev = seedSum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsiWilder(closes, period) {
  const p = period || 14;
  const out = new Array(closes.length).fill(null);
  if (closes.length <= p) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= p; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / p;
  let avgLoss = loss / p;
  out[p] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = p + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (p - 1) + Math.max(diff, 0)) / p;
    avgLoss = (avgLoss * (p - 1) + Math.max(-diff, 0)) / p;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macd(closes, fast, slow, signal) {
  const f = fast || 12, s = slow || 26, sig = signal || 9;
  const emaFast = ema(closes, f);
  const emaSlow = ema(closes, s);
  const line = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null));
  const compact = line.filter((v) => v != null);
  const sigCompact = ema(compact, sig);
  const signalLine = new Array(closes.length).fill(null);
  let j = 0;
  for (let i = 0; i < closes.length; i++) {
    if (line[i] != null) { signalLine[i] = sigCompact[j]; j++; }
  }
  const histogram = closes.map((_, i) => (line[i] != null && signalLine[i] != null ? line[i] - signalLine[i] : null));
  return { macdLine: line, signalLine, histogram };
}

/* ---------------- Backtest engine ----------------
 * Same rules as backend/app/engine.py (long-only crossover core):
 * signal read at bar t close -> filled at bar t+1 open, slippage adverse
 * on every fill, commission charged on entry AND exit. A still-open
 * position at the end is marked to market in the equity curve but is not
 * counted as a closed trade. */

function runBacktest(bars, opts) {
  const fast = opts.fast, slow = opts.slow;
  const capital = opts.capital;
  const comm = (opts.commissionPct || 0) / 100;
  const slip = (opts.slippagePct || 0) / 100;
  const closes = bars.map((b) => b.close);
  const fastLine = sma(closes, fast);
  const slowLine = sma(closes, slow);

  let cash = capital;
  let qty = 0;
  let entry = null; // {bar, price, qty, costTotal}
  let pending = null; // 'buy' | 'sell', decided at previous close
  const fills = [];
  const trades = [];
  const equityCurve = [];

  for (let i = 0; i < bars.length; i++) {
    // 1) Execute the pending order at this bar's OPEN.
    if (pending === 'buy' && qty === 0) {
      const fill = bars[i].open * (1 + slip);
      const q = Math.floor(cash / (fill * (1 + comm)));
      if (q > 0) {
        const costTotal = q * fill * (1 + comm);
        cash -= costTotal;
        qty = q;
        entry = { bar: i, price: fill, qty: q, costTotal };
        fills.push({ side: 'BUY', bar: i, date: bars[i].date, price: fill, qty: q, pnl: null });
      }
    } else if (pending === 'sell' && qty > 0) {
      const fill = bars[i].open * (1 - slip);
      const proceeds = qty * fill * (1 - comm);
      const pnl = proceeds - entry.costTotal;
      cash += proceeds;
      fills.push({ side: 'SELL', bar: i, date: bars[i].date, price: fill, qty, pnl });
      trades.push({
        entryBar: entry.bar, entryDate: bars[entry.bar].date, entryPrice: entry.price,
        exitBar: i, exitDate: bars[i].date, exitPrice: fill, qty, pnl,
      });
      qty = 0;
      entry = null;
    }
    pending = null;

    // 2) Decide the next order from THIS bar's close.
    if (i < bars.length - 1 && fastLine[i] != null && slowLine[i] != null) {
      const wantLong = fastLine[i] > slowLine[i];
      if (wantLong && qty === 0) pending = 'buy';
      else if (!wantLong && qty > 0) pending = 'sell';
    }

    // 3) Mark equity to market at this close.
    equityCurve.push(cash + qty * bars[i].close);
  }

  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1] : capital;
  const totalReturn = (finalEquity / capital - 1) * 100;

  let peak = -Infinity, maxDrawdown = 0;
  for (const e of equityCurve) {
    if (e > peak) peak = e;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - e) / peak) * 100);
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const grossProfit = trades.reduce((s, t) => s + Math.max(t.pnl, 0), 0);
  const grossLoss = trades.reduce((s, t) => s - Math.min(t.pnl, 0), 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const benchReturn = closes.length > 1 ? (closes[closes.length - 1] / closes[0] - 1) * 100 : 0;

  return {
    fills, trades, equityCurve,
    metrics: {
      totalReturn, maxDrawdown, winRate,
      tradeCount: trades.length, profitFactor,
      finalEquity, benchmarkReturn: benchReturn,
      openPosition: qty > 0 ? qty : 0,
    },
  };
}


/* ---------------- Browser UI (not used by Node tests) ---------------- */

const $ = (id) => document.getElementById(id);

function fmtINR(x, digits) {
  return '₹' + Number(x).toLocaleString('en-IN', {
    minimumFractionDigits: digits == null ? 2 : digits,
    maximumFractionDigits: digits == null ? 2 : digits,
  });
}
function fmtPct(x) { return (x > 0 ? '+' : '') + x.toFixed(2) + '%'; }
function cls(x) { return x > 0 ? 'pos' : (x < 0 ? 'neg' : ''); }

const state = {
  symbol: 'RELIANCE-DEMO',
  seed: 1,
  bars: [],
  blocks: [
    { side: 'entry', text: 'SMA 50 crosses above SMA 200' },
    { side: 'exit', text: 'SMA 50 crosses below SMA 200' },
  ],
  paper: { cash: 100000, positions: {}, history: [] },
};

function setupCanvas(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 800;
  canvas.style.height = cssHeight + 'px';
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: cssHeight };
}

function drawPriceChart() {
  const canvas = $('priceChart');
  if (!canvas || !state.bars.length) return;
  const { ctx, w, h } = setupCanvas(canvas, 340);
  const bars = state.bars;
  const closes = bars.map((b) => b.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const padR = 64, padL = 8, padT = 10, padB = 22;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  let min = Infinity, max = -Infinity;
  bars.forEach((b) => { min = Math.min(min, b.low); max = Math.max(max, b.high); });
  const span = (max - min) || 1;
  min -= span * 0.05; max += span * 0.05;
  const y = (v) => padT + (max - v) / (max - min) * plotH;
  const bw = plotW / bars.length;

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(30,42,63,0.8)';
  ctx.fillStyle = '#8fa3bd';
  ctx.font = '11px system-ui';
  for (let g = 0; g <= 4; g++) {
    const v = min + (max - min) * g / 4;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
    ctx.fillText(Math.round(v).toLocaleString('en-IN'), padL + plotW + 6, yy + 3);
  }
  ctx.fillText(bars[0].date, padL, h - 6);
  const lastDate = bars[bars.length - 1].date;
  ctx.fillText(lastDate, Math.max(padL, padL + plotW - ctx.measureText(lastDate).width), h - 6);

  bars.forEach((b, i) => {
    const x = padL + i * bw + bw / 2;
    const up = b.close >= b.open;
    ctx.strokeStyle = up ? '#16c784' : '#ea3943';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.moveTo(x, y(b.high)); ctx.lineTo(x, y(b.low)); ctx.stroke();
    const top = y(Math.max(b.open, b.close));
    const bot = y(Math.min(b.open, b.close));
    const bodyW = Math.max(1, bw * 0.65);
    ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, bot - top));
  });

  const drawLine = (series, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
    let started = false;
    series.forEach((v, i) => {
      if (v == null) return;
      const x = padL + i * bw + bw / 2;
      if (!started) { ctx.moveTo(x, y(v)); started = true; } else ctx.lineTo(x, y(v));
    });
    ctx.stroke(); ctx.lineWidth = 1;
  };
  drawLine(sma20, '#4f8ff7');
  drawLine(sma50, '#f59e0b');
}

function drawEquityChart(curve) {
  const canvas = $('equityChart');
  if (!canvas || !curve.length) return;
  const { ctx, w, h } = setupCanvas(canvas, 220);
  const padR = 70, padL = 8, padT = 10, padB = 8;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  let min = Math.min(...curve), max = Math.max(...curve);
  const span = (max - min) || 1;
  min -= span * 0.08; max += span * 0.08;
  const x = (i) => padL + (i / (curve.length - 1)) * plotW;
  const y = (v) => padT + (max - v) / (max - min) * plotH;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(30,42,63,0.8)';
  ctx.fillStyle = '#8fa3bd';
  ctx.font = '11px system-ui';
  [min, (min + max) / 2, max].forEach((v) => {
    ctx.beginPath(); ctx.moveTo(padL, y(v)); ctx.lineTo(padL + plotW, y(v)); ctx.stroke();
    ctx.fillText(Math.round(v).toLocaleString('en-IN'), padL + plotW + 6, y(v) + 3);
  });
  ctx.beginPath();
  curve.forEach((v, i) => { if (i === 0) ctx.moveTo(x(i), y(v)); else ctx.lineTo(x(i), y(v)); });
  ctx.strokeStyle = '#4f8ff7'; ctx.lineWidth = 1.8; ctx.stroke(); ctx.lineWidth = 1;
  ctx.lineTo(x(curve.length - 1), padT + plotH); ctx.lineTo(x(0), padT + plotH); ctx.closePath();
  ctx.fillStyle = 'rgba(79,143,247,0.15)'; ctx.fill();
}

function renderDashboard() {
  const bars = state.bars;
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2] || last;
  const change = last.close - prev.close;
  const changePct = prev.close ? (change / prev.close) * 100 : 0;
  $('statPrice').textContent = fmtINR(last.close);
  const chEl = $('statChange');
  chEl.textContent = `${change >= 0 ? '▲' : '▼'} ${fmtINR(Math.abs(change)).slice(0)} (${fmtPct(changePct)})`.replace('₹₹', '₹');
  chEl.className = 'stat-value ' + cls(change);
  $('statVolume').textContent = last.volume.toLocaleString('en-IN');
  const rsiArr = rsiWilder(closes, 14);
  const rsi = rsiArr[rsiArr.length - 1];
  $('statRsi').textContent = rsi == null ? '—' : rsi.toFixed(1);
  const m = macd(closes);
  const ml = m.macdLine[m.macdLine.length - 1];
  const sl = m.signalLine[m.signalLine.length - 1];
  $('statMacd').textContent = ml == null ? '—' : `${ml.toFixed(2)} / ${sl == null ? '—' : sl.toFixed(2)}`;
  drawPriceChart();
  renderPaper();
}

function regenerate() {
  state.bars = generateSampleBars(state.symbol, state.seed);
  renderDashboard();
  $('btSymbolNote').textContent = `Backtest runs on: ${SAMPLE_SYMBOLS[state.symbol].label} — ${state.bars.length} sample bars.`;
  $('btEmpty').textContent = 'Sample data changed — press “Run Backtest” to run on the new series.';
  $('btResults').hidden = true;
  $('equityChart').hidden = true;
  $('btTradesTable').hidden = true;
}

/* ---- Builder ---- */
function renderBlocks() {
  const ul = $('blockList');
  ul.innerHTML = '';
  state.blocks.forEach((b, idx) => {
    const li = document.createElement('li');
    li.className = 'block';
    const side = document.createElement('span');
    side.className = 'side ' + b.side;
    side.textContent = b.side.toUpperCase();
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = b.text;
    const up = document.createElement('button');
    up.className = 'b-btn'; up.textContent = '↑'; up.type = 'button';
    up.disabled = idx === 0;
    up.addEventListener('click', () => {
      [state.blocks[idx - 1], state.blocks[idx]] = [state.blocks[idx], state.blocks[idx - 1]];
      renderBlocks();
    });
    const down = document.createElement('button');
    down.className = 'b-btn'; down.textContent = '↓'; down.type = 'button';
    down.disabled = idx === state.blocks.length - 1;
    down.addEventListener('click', () => {
      [state.blocks[idx + 1], state.blocks[idx]] = [state.blocks[idx], state.blocks[idx + 1]];
      renderBlocks();
    });
    const del = document.createElement('button');
    del.className = 'b-btn'; del.textContent = '✕'; del.type = 'button';
    del.addEventListener('click', () => { state.blocks.splice(idx, 1); renderBlocks(); });
    li.append(side, text, up, down, del);
    ul.appendChild(li);
  });
  if (!state.blocks.length) {
    ul.innerHTML = '<li class="muted">No blocks — add one below.</li>';
  }
}

function operandText(kind, param) {
  if (kind === 'Price') return 'Price';
  if (kind === 'Value') return String(param);
  return `${kind} ${param}`;
}

function addBlock() {
  const side = $('newSide').value;
  const left = operandText($('newLeft').value, $('newLeftParam').value);
  const right = operandText($('newRight').value, $('newRightParam').value);
  const op = $('newOp').value;
  state.blocks.push({ side, text: `${left} ${op} ${right}` });
  renderBlocks();
}

/* ---- Backtest UI ---- */
function runBacktestUI() {
  const fast = parseInt($('btFast').value, 10);
  const slow = parseInt($('btSlow').value, 10);
  const capital = parseFloat($('btCapital').value);
  const commissionPct = parseFloat($('btCommission').value);
  const slippagePct = parseFloat($('btSlippage').value);
  const empty = $('btEmpty');
  if (!(fast >= 2) || !(slow > fast) || !(capital > 0)) {
    empty.textContent = 'Please check the inputs: Fast SMA must be at least 2, Slow SMA must be greater than Fast SMA, and capital must be positive.';
    return;
  }
  const res = runBacktest(state.bars, { fast, slow, capital, commissionPct, slippagePct });
  const m = res.metrics;
  $('btResults').hidden = false;
  const setM = (id, text, klass) => { const el = $(id); el.textContent = text; el.className = 'stat-value ' + (klass || ''); };
  setM('mReturn', fmtPct(m.totalReturn), cls(m.totalReturn));
  setM('mBench', fmtPct(m.benchmarkReturn), cls(m.benchmarkReturn));
  setM('mDrawdown', '−' + m.maxDrawdown.toFixed(2) + '%', m.maxDrawdown > 0 ? 'neg' : '');
  setM('mWinRate', m.tradeCount ? m.winRate.toFixed(1) + '%' : '—');
  setM('mTrades', String(m.tradeCount) + (m.openPosition ? ' (+1 open)' : ''));
  setM('mPf', m.tradeCount ? (m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)) : '—');
  setM('mEquity', fmtINR(m.finalEquity, 0), cls(m.totalReturn));
  $('equityChart').hidden = false;
  drawEquityChart(res.equityCurve);
  const body = $('btTradesBody');
  body.innerHTML = '';
  res.fills.forEach((f) => {
    const tr = document.createElement('tr');
    const pnl = f.pnl == null ? '—' : fmtINR(f.pnl);
    tr.innerHTML = '';
    const cells = [
      { t: f.side, c: f.side === 'BUY' ? 'buy' : 'sell' },
      { t: `#${f.bar} · ${f.date}` },
      { t: fmtINR(f.price) },
      { t: String(f.qty) },
      { t: pnl, c: f.pnl == null ? '' : cls(f.pnl) },
    ];
    cells.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell.t;
      if (cell.c) td.className = cell.c;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  $('btTradesTable').hidden = res.fills.length === 0;
  empty.textContent = res.fills.length === 0
    ? 'No trades: the fast SMA never crossed the slow SMA into a trade on this sample series. Try different periods or regenerate the data.'
    : `Backtest complete on ${SAMPLE_SYMBOLS[state.symbol].label} (${state.bars.length} sample bars). A position still open at the end is valued at the last close and is not counted as a closed trade.`;
}

/* ---- Paper trading ---- */
function paperPos() {
  return state.paper.positions[state.symbol] || { qty: 0, avgCost: 0 };
}
function lastPrice() {
  return state.bars.length ? state.bars[state.bars.length - 1].close : 0;
}
function renderPaper() {
  const p = state.paper;
  const pos = paperPos();
  const price = lastPrice();
  const unreal = pos.qty * (price - pos.avgCost);
  $('paperCash').textContent = fmtINR(p.cash, 0);
  $('paperPrice').textContent = fmtINR(price) + ' (Sample)';
  $('paperPosition').textContent = pos.qty ? `${pos.qty} shares @ avg ${fmtINR(pos.avgCost)}` : 'No position';
  const pnlEl = $('paperPnl');
  pnlEl.textContent = pos.qty ? fmtINR(unreal, 0) : '—';
  pnlEl.className = 'stat-value ' + (pos.qty ? cls(unreal) : '');
  $('paperEquity').textContent = fmtINR(p.cash + pos.qty * price, 0);
  const ul = $('paperHistory');
  ul.innerHTML = '';
  if (!p.history.length) {
    ul.innerHTML = '<li class="muted">No trades yet.</li>';
  } else {
    p.history.slice().reverse().forEach((hst) => {
      const li = document.createElement('li');
      li.textContent = hst;
      ul.appendChild(li);
    });
  }
}
function paperMsg(text, isError) {
  const el = $('paperMsg');
  el.textContent = text;
  el.className = 'paper-msg ' + (isError ? 'error' : 'ok');
}
function paperTrade(side) {
  const qty = parseInt($('paperQty').value, 10);
  const price = lastPrice();
  const p = state.paper;
  if (!(qty > 0)) { paperMsg('Enter a quantity of at least 1.', true); return; }
  const pos = paperPos();
  if (side === 'buy') {
    const cost = qty * price;
    if (cost > p.cash) {
      paperMsg(`Not enough virtual cash: ${qty} shares cost ${fmtINR(cost, 0)} but your balance is ${fmtINR(p.cash, 0)}.`, true);
      return;
    }
    const newQty = pos.qty + qty;
    pos.avgCost = (pos.qty * pos.avgCost + qty * price) / newQty;
    pos.qty = newQty;
    p.cash -= cost;
    p.positions[state.symbol] = pos;
    p.history.push(`BUY ${qty} × ${state.symbol} @ ${fmtINR(price)} (Sample) — cost ${fmtINR(cost, 0)}`);
    paperMsg(`Bought ${qty} shares at the sample price ${fmtINR(price)}.`, false);
  } else {
    if (qty > pos.qty) {
      paperMsg(`You cannot sell ${qty} shares — your position in ${state.symbol} is ${pos.qty}.`, true);
      return;
    }
    const proceeds = qty * price;
    const realised = qty * (price - pos.avgCost);
    pos.qty -= qty;
    if (pos.qty === 0) pos.avgCost = 0;
    p.positions[state.symbol] = pos;
    p.cash += proceeds;
    p.history.push(`SELL ${qty} × ${state.symbol} @ ${fmtINR(price)} (Sample) — realised P&L ${fmtINR(realised, 0)}`);
    paperMsg(`Sold ${qty} shares at the sample price ${fmtINR(price)}. Realised P&L ${fmtINR(realised, 0)}.`, false);
  }
  renderPaper();
}

/* ---- Assistant ---- */
const ASSISTANT_ANSWERS = {
  rsi: 'RSI (Relative Strength Index) measures how quickly and strongly a price has moved over the last 14 bars, on a 0–100 scale.\n\n• Above 70: often called "overbought" — the price rose fast and may pause.\n• Below 30: often called "oversold" — the price fell fast and may bounce.\n\nCaution: in a strong trend RSI can stay above 70 (or below 30) for a long time. Treat it as one clue among several, not a buy/sell button.',
  golden: 'The golden cross is a trend signal: the fast moving average SMA 50 crosses ABOVE the slow SMA 200, suggesting upward momentum is taking over; the reverse (SMA 50 crossing below SMA 200) is called a death cross.\n\nStrengths: simple, and it keeps you on the right side of big trends. Weaknesses: it is late (the trend has already moved), and in sideways markets it whipsaws — many small false signals. That is why the demo backtest uses 20/50 on 260 bars: 50/200 needs years of data to say anything.',
  drawdown: 'Drawdown is the fall from a peak to the next low point, shown as a %. Maximum drawdown is the worst such fall in a period.\n\nExample: an account rises to ₹1,20,000, falls to ₹90,000, then recovers. The drawdown was −25%.\n\nWhy it matters: a −50% drawdown needs a +100% gain just to break even. Small drawdowns are survivable; large ones break both accounts and confidence.',
  slippage: 'Slippage is the difference between the price you expected and the price your order actually filled at, because the market moved in between.\n\nIn backtests, ignoring slippage makes results look better than real life. That is why this demo (and the full engine) charges slippage on every fill: buys fill slightly above the open, sells slightly below.',
  profit: 'No. Nothing in AlgoTrade AI — or any trading tool — can guarantee profit.\n\nMarkets are driven by news, policy, earnings and human behaviour that no software can foresee. Any person or tool promising guaranteed returns is a red flag for fraud.\n\nWhat this platform CAN do: teach you how strategies behave on past data, charge realistic costs in backtests so results are not flattered, and let you practise with virtual money so mistakes cost nothing. Real trading always carries the risk of losing money, including money you cannot afford to lose.',
};

function init() {
  $('symbolSelect').addEventListener('change', (e) => {
    state.symbol = e.target.value;
    regenerate();
  });
  $('regenBtn').addEventListener('click', () => { state.seed += 1; regenerate(); });
  $('addBlockBtn').addEventListener('click', addBlock);
  $('runBacktestBtn').addEventListener('click', runBacktestUI);
  $('paperBuyBtn').addEventListener('click', () => paperTrade('buy'));
  $('paperSellBtn').addEventListener('click', () => paperTrade('sell'));
  $('paperResetBtn').addEventListener('click', () => {
    state.paper = { cash: 100000, positions: {}, history: [] };
    paperMsg('Account reset to ₹1,00,000 of virtual money.', false);
    renderPaper();
  });
  document.querySelectorAll('#assistantChips button').forEach((b) => {
    b.addEventListener('click', () => { $('assistantAnswer').textContent = ASSISTANT_ANSWERS[b.dataset.q] || ''; });
  });
  $('menuBtn').addEventListener('click', () => $('mainNav').classList.toggle('open'));
  document.querySelectorAll('#mainNav a').forEach((a) => {
    a.addEventListener('click', () => $('mainNav').classList.remove('open'));
  });
  window.addEventListener('resize', () => {
    drawPriceChart();
    if (!$('equityChart').hidden) runBacktestUI();
  });
  renderBlocks();
  regenerate();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    seedFromString, mulberry32, generateSampleBars, SAMPLE_SYMBOLS,
    sma, ema, rsiWilder, macd, runBacktest,
  };
}
