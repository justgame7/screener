// =========================================================================
// QUICK-EDIT SWITCHES - everything you normally need to change is in the
// two blocks below. Flip a value between true / false and save; nothing
// else in this file needs touching for a simple on/off.
// =========================================================================

// =========================================================================
// TIMEFRAME SWITCHES - one row per timeframe, both toggles side by side:
//
//   momentumDisplacement  ->  momentum breakout + ICT bullish displacement
//   retracement           ->  50% / 61.8% retracement screen
//
// Flip a value to `false` to stop THAT screen from scanning THAT timeframe
// (no section for it in that screen's Telegram message). The two columns are
// fully independent - e.g. Daily can be off for momentum/displacement and on
// for retracement, or the reverse. A timeframe's candles are only fetched if
// at least one of its two switches is on, and only once. Momentum and
// displacement share one switch, so they always cover the same timeframes.
//
// Weekly is retracement-only: it has no momentumDisplacement switch, and
// those screens never run on it.
//
// Leave TIMEFRAMES below (resolution, historyDays, thresholds) untouched.
// =========================================================================
const TIMEFRAME_SWITCHES = {
  //          momentumDisplacement   retracement
  '1H':     { momentumDisplacement: true, retracement: false },
  '4H':     { momentumDisplacement: true, retracement: true },
  Daily:    { momentumDisplacement: true, retracement: true },
  Weekly:   {                             retracement: false }, // retracement-only
};

// =========================================================================
// RETRACEMENT DIRECTION SWITCHES - which swing-leg direction(s) the 50% /
// 61.8% retracement screen reports. Same idea as the timeframe switches above.
//   bull: true  -> latest leg is an UP-leg (swing low, then swing high):
//                  price is pulling back down into the level. Shown as ▲.
//   bear: true  -> latest leg is a DOWN-leg (swing high, then swing low):
//                  price is bouncing up into the level. Shown as ▼.
// Both true  = both directions (default, matches screener.html).
// Both false = retracement screen is skipped entirely (no retracement
//              message is sent); momentum/displacement are unaffected.
// =========================================================================
const RETRACEMENT_DIRECTION_ENABLED = {
  bull: true,
  bear: false,
};

// ---------------------------------------------------------------------------
// End of quick-edit switches. Everything below is script internals.
// ---------------------------------------------------------------------------

// momentum-screen.js
//
// Standalone screener, for running headless (no browser/DOM) on a schedule
// via GitHub Actions. Runs THREE independent screens (four checks), ported
// exactly from screener.html's Custom Screens tab, on the same fetched
// candles for each timeframe below (1H / 4H / Daily for all screens; Weekly
// is retracement-only):
//
// 1) "Momentum breakout" (Trend):
//   { id:'breakout', cat:'Trend', title:'Momentum breakout',
//     desc:'24h move over 5% backed by a 2× volume surge',
//     conds:[{metric:'change24h',operator:'>',value:5},
//            {metric:'volRatio',operator:'>',value:2}], mode:'all' }
//
//   i.e. a coin is flagged when BOTH:
//     - 24h change > +5%
//     - latest candle's volume > 2x the average of the preceding 20 candles
//   are true at the same time. Unlike the Ichimoku breakout screener
//   (screen.js), this preset as defined in screener.html is one-directional
//   (bullish only) - there's no symmetric "-5% + 2x volume" bearish condition
//   in the preset itself (screener.html's "Top losers" preset covers downside
//   moves separately, with no volume-surge requirement attached). This file
//   mirrors that exactly: it only ever reports LONG-side momentum breakouts.
//
// 2) "Bullish displacement" (ICT / Smart Money):
//   { id:'ictDispBull', cat:'ICT', title:'Bullish displacement',
//     desc:'Current candle body is 1.8×+ ATR to the upside - an aggressive,
//           institutional-looking push',
//     conds:[{metric:'displacement',operator:'bullish',value:null}], mode:'all' }
//
//   i.e. a coin is flagged when the latest candle's body (|close-open|) is at
//   least 1.8x the 14-period ATR AND that candle closed green. Verbatim port
//   of screener.html's atr()/findDisplacement() pair. screener.html also
//   defines a symmetric 'ictDispBear' preset (same math, red candle) - not
//   ported here, since the ask was bullish-only, same one-directional stance
//   as the momentum preset above.
//
// 3) "Near 50% / 61.8% retracement" (Trend), percentage variants:
//   { id:'midpointRetrPct', conds:[{metric:'midpointPctDist',operator:'<',value:1}] }
//   { id:'fib618RetrPct',   conds:[{metric:'fib618PctDist',  operator:'<',value:1}] }
//
//   i.e. a coin is flagged when price sits within RETRACEMENT_DIST_PCT (1%)
//   of the 50% midpoint and/or the 61.8% level of the LATEST SWING LEG.
//   Verbatim port of screener.html's findSwingPoints(candles, 3) /
//   findMidpointRetracement() / findFib618Retracement():
//     - latest swing leg = most recent swing high <-> most recent swing low
//     - up-leg  (low came first)  -> direction 'bullish'
//       down-leg (high came first) -> direction 'bearish'
//     - 50%   level = (swingHigh + swingLow) / 2
//     - 61.8% level = high - 0.618*range (up-leg) / low + 0.618*range (down-leg)
//     - distance    = |price - level| / price * 100
//   The preset itself is direction-agnostic; RETRACEMENT_DIRECTION_ENABLED
//   below is this script's own switch to keep only up-legs, only down-legs,
//   or both. A coin matching both levels is shown once, tagged "50% + 61.8%",
//   in a single retracement alert. Retracement also has its own per-timeframe
//   on/off (TIMEFRAME_SWITCHES[tf].retracement), independent of the
//   momentumDisplacement switch, which governs momentum + displacement only.
//
// These screens are INDEPENDENT of each other and of timeframe - a coin
// passing on 1H has no bearing on whether it passes on 4H/Daily, and passing
// momentum has no bearing on passing displacement or retracement. Each
// timeframe's candles are fetched once and all checks are evaluated against
// that same data. Nothing is sent until every enabled timeframe has been
// scanned; results are then split into three separate Telegram messages sent
// to three separate bots (see TELEGRAM env vars near sendTelegramMessage
// below).
//
// DATA SOURCE: CoinDCX public API only - same two endpoints and same
// reasoning as screen.js (see that file's own header comment for the full
// investigation history of the candlesticks endpoint). Copied here rather
// than imported so this file stays a single, independently-schedulable
// script:
//   - GET https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments
//     Full list of active futures instrument pair strings ("B-BTC_USDT"),
//     filtered here to pairs ending in "_USDT".
//   - GET https://public.coindcx.com/market_data/candlesticks
//         ?pair=B-1000PEPE_USDT&resolution=1d&from=<unix_seconds>&to=<unix_seconds>&pcode=f
//     Undocumented futures candle endpoint - "candlesticks" (plural),
//     "resolution" not "interval", from/to in UNIX SECONDS but each
//     candle's own "time" field in UNIX MILLISECONDS, "pcode=f" routes to
//     the futures series, response wrapped as { s:"ok", data:[...] }.
//     "volume" is target-currency units (e.g. PEPE, not USDT).
//
// 24H CHANGE - IMPORTANT CAVEAT, read before trusting the numbers below:
// screener.html's browser version reads change24h straight off a live
// exchange ticker (ticker.priceChangePercent) - a true, ticker-sourced 24h
// change that's the same number regardless of which timeframe you're
// scanning. This standalone script has no equivalent call: CoinDCX's public
// futures ticker endpoint/field names aren't confirmed the way the
// candlesticks endpoint above was (that one was captured from a real
// network request - see screen.js). Rather than guess at another
// undocumented endpoint, 24h change here is computed directly from each
// timeframe's OWN candle series instead: the % move from the candle
// roughly 24 hours before the latest one (24 bars back on 1H, 6 bars back
// on 4H, 1 bar back on Daily - see TIMEFRAMES.lookbackBars below). This is
// self-consistent within a timeframe and a very close approximation, but
// it is a computed stand-in, not the literal exchange-ticker figure
// screener.html shows. If a real CoinDCX futures ticker endpoint gets
// confirmed later (browser DevTools -> Network -> XHR on CoinDCX's own
// futures markets page, same method used to find the candlesticks
// endpoint), swap this out for that instead.
//
// Run locally to test:
//   MOMENTUM_TELEGRAM_BOT_TOKEN=xxx MOMENTUM_TELEGRAM_CHAT_ID=xxx \
//   DISPLACEMENT_TELEGRAM_BOT_TOKEN=yyy DISPLACEMENT_TELEGRAM_CHAT_ID=yyy \
//   RETRACEMENT_TELEGRAM_BOT_TOKEN=zzz RETRACEMENT_TELEGRAM_CHAT_ID=zzz \
//   node screen.js
//
// See README.md for the one-time Telegram bot setup; this is intended to be
// scheduled the same way screen.js is (see .github/workflows/screener.yml),
// just as a second, independent workflow/step.

// Derived from the quick-edit switches at the top of the file - not meant to be edited.
const RETRACEMENT_ACTIVE = RETRACEMENT_DIRECTION_ENABLED.bull || RETRACEMENT_DIRECTION_ENABLED.bear;

// Which screens run on a given timeframe (see the switch blocks at the top of the file).
const mdEnabled = (tf) => !tf.retracementOnly && !!(TIMEFRAME_SWITCHES[tf.label] || {}).momentumDisplacement; // momentum + displacement (never on retracement-only timeframes)
const retrEnabled = (tf) => RETRACEMENT_ACTIVE && !!(TIMEFRAME_SWITCHES[tf.label] || {}).retracement; // retracement

const COINDCX_API_BASE = 'https://api.coindcx.com';
const COINDCX_PUBLIC_BASE = 'https://public.coindcx.com';
const ACTIVE_INSTRUMENTS_URL = `${COINDCX_API_BASE}/exchange/v1/derivatives/futures/data/active_instruments`;
const FUTURES_CANDLES_URL = `${COINDCX_PUBLIC_BASE}/market_data/candlesticks`;

// Preset thresholds - verbatim from screener.html's 'breakout' preset.
const CHANGE_THRESHOLD_PCT = 5;   // change24h > 5
const VOLRATIO_THRESHOLD = 2;     // volRatio > 2
const VOLRATIO_WINDOW = 20;       // volumeRatio()'s trailing-average window in screener.html

// Preset threshold - verbatim from screener.html's 'ictDispBull' preset
// default (findDisplacement(candles, atrVal, 1.8) in screener.html).
const ATR_LENGTH = 14;            // atr(candles, length=14)
const DISPLACEMENT_MULT = 1.8;    // body >= 1.8x ATR to flag as displacement

// Preset thresholds - verbatim from screener.html's 'midpointRetrPct' and
// 'fib618RetrPct' presets (midpointPctDist < 1, fib618PctDist < 1) and
// findSwingPoints(candles, 3).
const RETRACEMENT_DIST_PCT = 1;   // price within 1% of the level
const SWING_SPAN = 3;             // bars on each side for a swing high/low

// Three timeframes, each needing:
//   - enough bars for a 20-bar trailing volume average (VOLRATIO_WINDOW + 1)
//   - a bar ~24h before the latest one, per lookbackBars (see the 24H CHANGE
//     caveat above): 24 bars on 1H, 6 bars on 4H, 1 bar on Daily.
// historyDays is generous over the minimum needed (same "comfortably over"
// philosophy screen.js uses for its own TIMEFRAMES) so a stray gap in
// candle history doesn't tip a symbol into the "insufficient bar history"
// error bucket.
// minVolume is USDT notional (close * volume) of the latest candle, same
// gate style as screen.js's minVolume - just one candle here (this preset
// has no "closed OR forming" volume-gate logic to port from screener.html,
// since volumeRatio() itself already looks at the still-forming last
// candle). Thresholds scale down for shorter timeframes since typical
// per-candle notional volume is naturally smaller than Daily's.
const TIMEFRAMES = [
  { label: '1H', resolution: '1h', historyDays: 10, minVolume: 250_000, lookbackBars: 24 },
  { label: '4H', resolution: '4h', historyDays: 40, minVolume: 1_000_000, lookbackBars: 6 },
  { label: 'Daily', resolution: '1d', historyDays: 90, minVolume: 10_000_000, lookbackBars: 1 },
  // Weekly: RETRACEMENT ONLY (retracementOnly: true) - momentum/displacement
  // never run on it, whatever TIMEFRAME_SWITCHES says, so lookbackBars below is
  // unused (the 24h-change proxy isn't meaningful on weekly bars). Switch it
  // on/off via TIMEFRAME_SWITCHES.Weekly.retracement. historyDays: 730 (~104
  // weekly bars) so there are enough bars for confirmed swing points.
  // minVolume is a starting guess scaled up from Daily's - tune to taste.
  // NOTE: resolution '1w' follows the same lowercase style as '1h'/'4h'/'1d'
  // above; CoinDCX's docs list weekly candles but this exact value hasn't been
  // confirmed against the live endpoint. If Weekly comes back with "no candle
  // data" / HTTP errors for every symbol, try '1W'.
  { label: 'Weekly', resolution: '1w', historyDays: 730, minVolume: 50_000_000, lookbackBars: 1, retracementOnly: true },
];

const CONCURRENCY = 3; // conservative starting point, same rationale as screen.js

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Global pacing throttle: enforces a minimum gap between the start of any
// two requests across ALL lanes - same approach as screen.js.
const MIN_REQUEST_GAP_MS = 300;
let nextSlot = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_REQUEST_GAP_MS;
  if (wait > 0) await sleep(wait);
}

// ---------------- fetch helpers ----------------
async function fetchWithTimeout(url, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Retries HTTP 429 with exponential backoff + jitter before giving up.
const MAX_429_RETRIES = 8;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 12000;

async function fetchJSON(url) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    await throttle();
    try {
      const res = await fetchWithTimeout(url);
      const raw = await res.text();
      if (res.status === 429) {
        const err = new Error(`HTTP 429 for ${url} :: ${raw.slice(0, 200)}`);
        err.isRateLimit = true;
        throw err;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url} :: ${raw.slice(0, 300)}`);
      }
      if (!raw) {
        throw new Error(`Empty body (status ${res.status}) for ${url}`);
      }
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`Non-JSON body (status ${res.status}) for ${url} :: ${raw.slice(0, 300)}`);
      }
    } catch (e) {
      lastErr = e;
      if (e.isRateLimit && attempt < MAX_429_RETRIES) {
        const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) + Math.random() * 300;
        await sleep(delay);
        continue;
      }
      console.error(`fetchJSON failed for ${url}: ${e.message}`);
      break;
    }
  }
  throw lastErr;
}

// ---------------- symbol universe ----------------
async function getUSDTPerpetualSymbols() {
  const data = await fetchJSON(ACTIVE_INSTRUMENTS_URL);
  return data.filter((pair) => pair.endsWith('_USDT'));
}

// ---------------- klines ----------------
async function getKlines(pair, resolution, historyDays) {
  const toSec = Math.floor(Date.now() / 1000);
  const fromSec = toSec - historyDays * 86400;
  const qs = new URLSearchParams({
    pair,
    resolution,
    from: String(fromSec),
    to: String(toSec),
    pcode: 'f',
  });
  const body = await fetchJSON(`${FUTURES_CANDLES_URL}?${qs.toString()}`);
  const rows = Array.isArray(body) ? body : (body && Array.isArray(body.data) ? body.data : null);
  if (!rows) {
    const status = body && body.s ? body.s : 'unknown';
    throw new Error(`unexpected candlesticks response shape (status: ${status})`);
  }
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  return sorted.map((k) => {
    const close = parseFloat(k.close);
    const volume = parseFloat(k.volume);
    return {
      openTime: Number(k.time),
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close,
      volume,
      quoteVolume: close * volume,
    };
  });
}

// ---------------- momentum breakout core ----------------
// Verbatim port of screener.html's 'breakout' preset math:
//   change24h = 24h % move (see the 24H CHANGE caveat at the top of this
//               file for how that's computed here vs. in screener.html)
//   volRatio  = volumeRatio(candles): last candle's volume / average
//               volume of the preceding 20 candles
//   passed    = change24h > 5 AND volRatio > 2  (mode:'all')
function computeMomentumSignal(symbol, candles, tf) {
  const needed = Math.max(VOLRATIO_WINDOW + 1, tf.lookbackBars + 1);
  if (candles.length < needed) {
    throw new Error(`insufficient bar history (${candles.length}/${needed} bars)`);
  }

  const last = candles[candles.length - 1];
  const price = last.close;
  if (!Number.isFinite(price)) throw new Error('current price unavailable');

  const prevBar = candles[candles.length - 1 - tf.lookbackBars];
  if (!prevBar || !(prevBar.close > 0)) throw new Error('no reference candle for 24h change');
  const change24h = ((price - prevBar.close) / prevBar.close) * 100;

  // volumeRatio(candles): trailing = candles.slice(-21,-1); avg of those 20;
  // last candle's volume / that avg.
  const trailing = candles.slice(-(VOLRATIO_WINDOW + 1), -1);
  const avgVol = trailing.length === VOLRATIO_WINDOW
    ? trailing.reduce((s, c) => s + c.volume, 0) / VOLRATIO_WINDOW
    : NaN;
  const volRatio = (Number.isFinite(avgVol) && avgVol > 0) ? last.volume / avgVol : null;

  const passed = change24h > CHANGE_THRESHOLD_PCT && volRatio !== null && volRatio > VOLRATIO_THRESHOLD;

  return {
    symbol,
    price,
    change24h,
    volRatio,
    passed,
    volToday: price * last.volume, // USDT notional of the latest candle - used for the minVolume gate
  };
}

// ---------------- ICT bullish displacement core ----------------
// Wilder's ATR - verbatim port of screener.html's atr(candles, length=14).
function atr(candles, length = ATR_LENGTH) {
  if (candles.length <= length) return NaN;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let v = tr.slice(0, length).reduce((s, x) => s + x, 0) / length;
  for (let i = length; i < tr.length; i++) v = (v * (length - 1) + tr[i]) / length;
  return v;
}

// Displacement: verbatim port of screener.html's findDisplacement(candles,
// atrVal, mult) - the latest candle's body vs. ATR. Only the bullish side is
// computed/returned (see header comment: bearish is a separate, unported
// preset).
function findDisplacement(candles, atrVal, mult = DISPLACEMENT_MULT) {
  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  if (!Number.isFinite(atrVal) || atrVal <= 0) return { bullish: false, ratio: null };
  const ratio = body / atrVal;
  return { bullish: ratio >= mult && last.close > last.open, ratio };
}

// passed = latest candle's body >= 1.8x ATR(14) AND that candle closed green
// (mode:'all' on a single condition, same shape as computeMomentumSignal).
// change24h is reported alongside for context (not part of the pass/fail
// condition itself) - same computed-proxy caveat as momentum's change24h:
// see the "24H CHANGE" note at the top of this file.
function computeDisplacementSignal(symbol, candles, tf) {
  const needed = Math.max(ATR_LENGTH + 1, tf.lookbackBars + 1);
  if (candles.length < needed) throw new Error(`insufficient bar history (${candles.length}/${needed} bars)`);

  const last = candles[candles.length - 1];
  const price = last.close;
  if (!Number.isFinite(price)) throw new Error('current price unavailable');

  const prevBar = candles[candles.length - 1 - tf.lookbackBars];
  if (!prevBar || !(prevBar.close > 0)) throw new Error('no reference candle for 24h change');
  const change24h = ((price - prevBar.close) / prevBar.close) * 100;

  const atrVal = atr(candles, ATR_LENGTH);
  const disp = findDisplacement(candles, atrVal, DISPLACEMENT_MULT);
  const passed = disp.bullish;

  return {
    symbol,
    price,
    change24h,
    atrVal,
    displacementRatio: disp.ratio,
    passed,
    volToday: price * last.volume, // USDT notional of the latest candle - used for the minVolume gate
  };
}

// ---------------- 50% / 61.8% retracement core ----------------
// Verbatim port of screener.html's findSwingPoints(candles, span): wick-based
// swing highs/lows, a pivot needing `span` lower highs / higher lows on both
// sides (so the last `span` candles can never be confirmed swings yet).
function findSwingPoints(candles, span = SWING_SPAN) {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const swingHighs = [], swingLows = [];
  for (let i = span; i < candles.length - span; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
    }
    if (isHigh) swingHighs.push({ idx: i, price: highs[i] });
    if (isLow) swingLows.push({ idx: i, price: lows[i] });
  }
  return { swingHighs, swingLows };
}

// Port of findMidpointRetracement() + findFib618Retracement() (percentage
// distances only), computed off the same latest swing leg. As in
// screener.html: the 50% level needs no positive range, the 61.8% level does.
// No confirmed swing pair yet -> no signal (not an error), same as the
// browser, where a null distance simply fails the condition.
function computeRetracementSignal(symbol, candles, tf) {
  const needed = SWING_SPAN * 2 + 1;
  if (candles.length < needed) {
    throw new Error(`insufficient bar history (${candles.length}/${needed} bars)`);
  }

  const last = candles[candles.length - 1];
  const price = last.close;
  if (!Number.isFinite(price) || !(price > 0)) throw new Error('current price unavailable');

  const result = {
    symbol,
    price,
    direction: null,      // 'bullish' (up-leg) | 'bearish' (down-leg)
    mid: null,
    level618: null,
    midDistPct: null,
    fib618DistPct: null,
    pass50: false,
    pass618: false,
    passed: false,
    volToday: price * last.volume, // USDT notional of the latest candle - used for the minVolume gate
  };

  const { swingHighs, swingLows } = findSwingPoints(candles, SWING_SPAN);
  if (!swingHighs.length || !swingLows.length) return result;

  const lastHigh = swingHighs[swingHighs.length - 1];
  const lastLow = swingLows[swingLows.length - 1];
  if (lastHigh.idx === lastLow.idx) return result;

  result.direction = lastLow.idx < lastHigh.idx ? 'bullish' : 'bearish';

  result.mid = (lastHigh.price + lastLow.price) / 2;
  result.midDistPct = Math.abs(price - result.mid) / price * 100;

  const range = lastHigh.price - lastLow.price;
  if (range > 0) {
    result.level618 = result.direction === 'bullish'
      ? lastHigh.price - 0.618 * range
      : lastLow.price + 0.618 * range;
    result.fib618DistPct = Math.abs(price - result.level618) / price * 100;
  }

  result.pass50 = result.midDistPct < RETRACEMENT_DIST_PCT;
  result.pass618 = result.fib618DistPct !== null && result.fib618DistPct < RETRACEMENT_DIST_PCT;
  result.passed = result.pass50 || result.pass618;
  return result;
}

// Fetches candles ONCE per symbol/timeframe and evaluates all presets
// against that same data. The presets are scored independently (own
// try/catch) so an edge case that trips one preset's bar-count guard doesn't
// also discard the other presets' results for that symbol.
async function screenSymbol(symbol, tf) {
  const candles = await getKlines(symbol, tf.resolution, tf.historyDays);
  if (candles.length === 0) throw new Error(`no candle data returned (requested ${tf.historyDays}d window)`);

  const result = { symbol };
  if (mdEnabled(tf)) {
    try {
      result.momentum = computeMomentumSignal(symbol, candles, tf);
    } catch (e) {
      result.momentumError = e.message;
    }
    try {
      result.displacement = computeDisplacementSignal(symbol, candles, tf);
    } catch (e) {
      result.displacementError = e.message;
    }
  }
  if (retrEnabled(tf)) {
    try {
      result.retracement = computeRetracementSignal(symbol, candles, tf);
    } catch (e) {
      result.retracementError = e.message;
    }
  }
  return result;
}

// ---------------- concurrency-limited queue (same as screen.js) ----------------
async function runPool(items, worker, concurrency) {
  let idx = 0;
  const results = new Array(items.length);
  async function next() {
    while (idx < items.length) {
      const my = idx++;
      try {
        results[my] = await worker(items[my]);
      } catch (e) {
        results[my] = { error: e.message, symbol: items[my] };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, next);
  await Promise.all(workers);
  return results;
}

// ---------------- per-timeframe scan ----------------
// Buckets a list of {symbol, error} rows by cause and logs them, same
// grouping logic used for both presets' error diagnostics below.
function logErrorBuckets(tfLabel, presetLabel, errored) {
  if (!errored.length) return;
  const buckets = new Map();
  for (const r of errored) {
    const label = r.error.startsWith('insufficient bar history') ? 'insufficient bar history'
      : r.error.startsWith('no candle data returned') ? 'no candle data returned'
      : r.error.startsWith('no reference candle') ? 'no reference candle for 24h change'
      : r.error.startsWith('current price unavailable') ? 'current price unavailable'
      : r.error.startsWith('HTTP ') || r.error.includes('fetch') ? 'fetch/HTTP error'
      : 'other';
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(r);
  }
  console.log(`[${tfLabel}] ${presetLabel} errors by cause:`);
  for (const [label, rows] of buckets) {
    const symbolList = rows.map((r) => stripUsdt(r.symbol)).join(', ');
    console.log(`  ${label} (${rows.length}): ${symbolList}`);
  }
}

async function runTimeframeScan(symbols, tf) {
  const screensOn = [
    mdEnabled(tf) && 'momentum breakout + bullish displacement',
    retrEnabled(tf) && '50%/61.8% retracement',
  ].filter(Boolean).join(' + ');
  console.log(`\nScanning ${symbols.length} symbols on ${tf.label} (resolution=${tf.resolution}) for ${screensOn}...`);

  const raw = await runPool(symbols, (s) => screenSymbol(s, tf), CONCURRENCY);
  // Whole-symbol failures (candle fetch itself failed) - shared by both presets.
  const fetchErrored = raw.filter((r) => r && r.error);
  const scanned = raw.filter((r) => r && !r.error);

  let momentumHits = [], dispHits = [];
  if (mdEnabled(tf)) {
    // ---- Momentum breakout ----
    const momentumScanned = scanned.filter((r) => r.momentum);
    const momentumErrored = scanned.filter((r) => r.momentumError).map((r) => ({ symbol: r.symbol, error: r.momentumError }));
    const momentumMatched = momentumScanned.filter((r) => r.momentum.passed);
    momentumHits = momentumMatched
      .filter((r) => r.momentum.volToday > tf.minVolume)
      .map((r) => r.momentum)
      .sort((a, b) => b.change24h - a.change24h); // strongest movers first

    console.log(
      `[${tf.label}] Momentum: ${symbols.length} symbols -> ${momentumScanned.length} scanned ok, ` +
      `${fetchErrored.length + momentumErrored.length} errored, ` +
      `${momentumMatched.length} matched change>+${CHANGE_THRESHOLD_PCT}%/vol>${VOLRATIO_THRESHOLD}x, ` +
      `${momentumHits.length} passed the $${tf.minVolume.toLocaleString()} volume gate.`
    );
    logErrorBuckets(tf.label, 'Momentum', [...fetchErrored, ...momentumErrored]);
    if (momentumMatched.length === 0 && momentumScanned.length) {
      const top = [...momentumScanned]
        .sort((a, b) => b.momentum.change24h - a.momentum.change24h)
        .slice(0, 3)
        .map((r) => `${stripUsdt(r.symbol)} ${fmt(r.momentum.change24h, 2)}% (vol×${r.momentum.volRatio !== null ? fmt(r.momentum.volRatio, 2) : '—'})`)
        .join(', ');
      console.log(`[${tf.label}] Momentum: no matches - closest by 24h change: ${top}`);
    }

    // ---- ICT bullish displacement ----
    const dispScanned = scanned.filter((r) => r.displacement);
    const dispErrored = scanned.filter((r) => r.displacementError).map((r) => ({ symbol: r.symbol, error: r.displacementError }));
    const dispMatched = dispScanned.filter((r) => r.displacement.passed);
    // NOTE: screener.html's 'ictDispBull' preset itself has no volume gate -
    // reusing tf.minVolume here is this file's own choice (same rationale as
    // momentum's gate: filter illiquid futures out of a headless alert feed).
    // Drop this .filter() line if you'd rather match the preset literally.
    dispHits = dispMatched
      .filter((r) => r.displacement.volToday > tf.minVolume)
      .map((r) => r.displacement)
      .sort((a, b) => b.displacementRatio - a.displacementRatio); // biggest ATR multiples first

    console.log(
      `[${tf.label}] Displacement: ${symbols.length} symbols -> ${dispScanned.length} scanned ok, ` +
      `${fetchErrored.length + dispErrored.length} errored, ` +
      `${dispMatched.length} matched body>=${DISPLACEMENT_MULT}x ATR(${ATR_LENGTH}) bullish, ` +
      `${dispHits.length} passed the $${tf.minVolume.toLocaleString()} volume gate.`
    );
    logErrorBuckets(tf.label, 'Displacement', [...fetchErrored, ...dispErrored]);
    if (dispMatched.length === 0 && dispScanned.length) {
      const top = [...dispScanned]
        .sort((a, b) => (b.displacement.displacementRatio ?? -Infinity) - (a.displacement.displacementRatio ?? -Infinity))
        .slice(0, 3)
        .map((r) => `${stripUsdt(r.symbol)} ${r.displacement.displacementRatio !== null ? fmt(r.displacement.displacementRatio, 2) : '—'}× ATR`)
        .join(', ');
      console.log(`[${tf.label}] Displacement: no matches - closest by ATR ratio: ${top}`);
    }
  }

  // ---- 50% / 61.8% retracement ----
  let retracementHits = [];
  if (retrEnabled(tf)) {
    const dirAllowed = (r) =>
      (r.retracement.direction === 'bullish' && RETRACEMENT_DIRECTION_ENABLED.bull) ||
      (r.retracement.direction === 'bearish' && RETRACEMENT_DIRECTION_ENABLED.bear);
    const closestPct = (x) => Math.min(
      x.pass50 ? x.midDistPct : Infinity,
      x.pass618 ? x.fib618DistPct : Infinity
    );

    const retrScanned = scanned.filter((r) => r.retracement);
    const retrErrored = scanned.filter((r) => r.retracementError).map((r) => ({ symbol: r.symbol, error: r.retracementError }));
    const retrMatched = retrScanned.filter((r) => r.retracement.passed && dirAllowed(r));
    // Volume gate applies strictly: latest candle's USDT notional must exceed tf.minVolume.
    retracementHits = retrMatched
      .filter((r) => r.retracement.volToday > tf.minVolume)
      .map((r) => r.retracement)
      .sort((a, b) => closestPct(a) - closestPct(b)); // closest to a level first

    const dirLabel = [RETRACEMENT_DIRECTION_ENABLED.bull && 'bull', RETRACEMENT_DIRECTION_ENABLED.bear && 'bear'].filter(Boolean).join('+');
    console.log(
      `[${tf.label}] Retracement: ${symbols.length} symbols -> ${retrScanned.length} scanned ok, ` +
      `${fetchErrored.length + retrErrored.length} errored, ` +
      `${retrMatched.length} within ${RETRACEMENT_DIST_PCT}% of 50%/61.8% (${dirLabel} legs), ` +
      `${retracementHits.length} passed the $${tf.minVolume.toLocaleString()} volume gate.`
    );
    logErrorBuckets(tf.label, 'Retracement', [...fetchErrored, ...retrErrored]);
    if (retrMatched.length === 0 && retrScanned.length) {
      const nearest = (r) => Math.min(
        r.retracement.midDistPct ?? Infinity,
        r.retracement.fib618DistPct ?? Infinity
      );
      const top = retrScanned
        .filter((r) => r.retracement.direction && dirAllowed(r) && Number.isFinite(nearest(r)))
        .sort((a, b) => nearest(a) - nearest(b))
        .slice(0, 3)
        .map((r) => `${stripUsdt(r.symbol)} ${fmt(nearest(r), 2)}%`)
        .join(', ');
      console.log(`[${tf.label}] Retracement: no matches - closest to a level: ${top || '—'}`);
    }
  }

  return { momentumHits, dispHits, retracementHits };
}

// ---------------- formatting ----------------
function stripUsdt(s) {
  return s.replace(/^B-/, '').replace(/_USDT$/, '');
}

function stripSizePrefix(coin) {
  return coin.replace(/^(1000000|100000|10000|1000|100|10)([A-Z].*)$/, '$2');
}

function fmt(n, d = 4) {
  return (n === undefined || n === null || isNaN(n)) ? '—' : n.toFixed(d);
}

// "coinname . 24h change . ltp" - e.g. "$PEPE · +18.42% · ₮0.0000123"
function fmtRow(r) {
  const coin = stripSizePrefix(stripUsdt(r.symbol));
  const chgText = (r.change24h >= 0 ? '+' : '') + fmt(r.change24h, 2) + '%';
  return `<b>$${coin}</b> · ${chgText} · ₮ <code>${fmt(r.price)}</code>`;
}
// "coinname . displacement ratio . 24h change . ltp" - e.g. "$ORCA · 1.99× · +10.67% · ₮1.8460"
function fmtDispRow(r) {
  const coin = stripSizePrefix(stripUsdt(r.symbol));
  const ratioText = fmt(r.displacementRatio, 2) + '×';
  const chgText = (r.change24h >= 0 ? '+' : '') + fmt(r.change24h, 2) + '%';
  return `<b>$${coin}</b> · ${ratioText} · ${chgText} · ₮ <code>${fmt(r.price)}</code>`;
}
// "coinname . leg dir . level tag(s) w/ distance . ltp"
// e.g. "$ORCA ▲ · 50% + 61.8% · ₮1.8460"  (▲ up-leg, ▼ down-leg)
function fmtRetraceRow(r) {
  const coin = stripSizePrefix(stripUsdt(r.symbol));
  const arrow = r.direction === 'bullish' ? '▲' : '▼';
  const tags = [];
  if (r.pass50) tags.push('50%');
  if (r.pass618) tags.push('61.8%');
  return `<b>$${coin}</b> ${arrow} · ${tags.join(' + ')} · ₮ <code>${fmt(r.price)}</code>`;
}
function fmtSection(rows, formatter = fmtRow) {
  return rows.length ? rows.map(formatter).join('\n') : 'none';
}

// Retracement alerts are grouped instead of one flat list. Order:
//   ▲ Bull: 50% only -> 61.8% only -> both 50% & 61.8%
//   ▼ Bear: 50% only -> 61.8% only -> both 50% & 61.8%
// Empty groups are omitted. Inside each group the rows keep the
// closest-to-a-level-first order that runTimeframeScan already applied.
const RETRACE_DIRECTION_ORDER = [
  { key: 'bullish', arrow: '▲', name: 'Bull' },
  { key: 'bearish', arrow: '▼', name: 'Bear' },
];
const RETRACE_LEVEL_ORDER = [
  { key: '50', label: '50%', match: (r) => r.pass50 && !r.pass618 },
  { key: '618', label: '61.8%', match: (r) => r.pass618 && !r.pass50 },
  { key: 'both', label: '50% & 61.8%', match: (r) => r.pass50 && r.pass618 },
];

function fmtRetraceGroups(hits) {
  const blocks = [];
  for (const dir of RETRACE_DIRECTION_ORDER) {
    for (const lvl of RETRACE_LEVEL_ORDER) {
      const rows = hits.filter((r) => r.direction === dir.key && lvl.match(r));
      if (!rows.length) continue;
      blocks.push(`<b>${dir.arrow} ${dir.name} · ${lvl.label} (${rows.length})</b>\n${rows.map(fmtRetraceRow).join('\n')}`);
    }
  }
  return blocks.join('\n\n');
}

function formatIST(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} IST`;
}

// ---------------- Telegram ----------------
function splitMessage(text, maxLen = 3500) {
  if (text.length <= maxLen) return [text];
  const parts = text.split('\n\n');
  const chunks = [];
  let current = '';
  for (const part of parts) {
    const candidate = current ? current + '\n\n' + part : part;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function sendTelegramMessage(text, token, chatId, label = 'Telegram') {
  const chunks = splitMessage(text);

  if (!token || !chatId) {
    console.log(`${label}: bot token / chat id not set - skipping send (${chunks.length} message(s) would be sent).\n---\n` + text);
    return;
  }

  for (let i = 0; i < chunks.length; i++) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunks[i],
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${label} Telegram send failed (part ${i + 1}/${chunks.length}): HTTP ${res.status} ${body}`);
    }
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
}

// ---------------- main ----------------
async function main() {
  const activeTimeframes = TIMEFRAMES.filter((tf) => mdEnabled(tf) || retrEnabled(tf));

  const mdSkipped = TIMEFRAMES.filter((tf) => !tf.retracementOnly && !mdEnabled(tf)).map((tf) => tf.label);
  if (mdSkipped.length) console.log(`Momentum/displacement: timeframe(s) disabled via TIMEFRAME_SWITCHES.momentumDisplacement, skipping: ${mdSkipped.join(', ')}`);
  if (!RETRACEMENT_ACTIVE) {
    console.log('Both retracement directions disabled via RETRACEMENT_DIRECTION_ENABLED - retracement screen skipped.');
  } else {
    const retrSkipped = TIMEFRAMES.filter((tf) => !retrEnabled(tf)).map((tf) => tf.label);
    if (retrSkipped.length) console.log(`Retracement: timeframe(s) disabled via TIMEFRAME_SWITCHES.retracement, skipping: ${retrSkipped.join(', ')}`);
  }
  if (!activeTimeframes.length) {
    console.log('No timeframe is enabled for momentum/displacement or retracement - nothing to scan, exiting without fetching or sending anything.');
    return;
  }

  console.log(`Fetching USDT perpetual symbol list (CoinDCX)...`);
  const symbols = await getUSDTPerpetualSymbols();

  const scans = [];
  for (const tf of activeTimeframes) {
    const { momentumHits, dispHits, retracementHits } = await runTimeframeScan(symbols, tf);
    scans.push({ tf, momentumHits, dispHits, retracementHits });
  }

  const stamp = formatIST(new Date());

  const sectionFor = (tfLabel, hits, formatter, matchLabel) =>
    `<b>— ${tfLabel} —</b>\n` + (hits.length ? `<b>${matchLabel} (${hits.length})</b>\n${fmtSection(hits, formatter)}` : 'none');

  // Each message only carries the timeframes enabled for ITS screen(s), and
  // is skipped altogether if none are (see mdEnabled / retrEnabled).
  const mdScans = scans.filter((s) => mdEnabled(s.tf));
  const retrScans = scans.filter((s) => retrEnabled(s.tf));

  const momentumMessage = mdScans.length
    ? `<b>Momentum breakout screener (CoinDCX) — ${stamp}</b>\n\n` +
      mdScans.map((s) => sectionFor(s.tf.label, s.momentumHits, fmtRow, 'Breakouts')).join('\n\n') + '\n\n' +
      `24h % > +${CHANGE_THRESHOLD_PCT} · Vol > ${VOLRATIO_THRESHOLD}× 20-bar avg`
    : null;

  const displacementMessage = mdScans.length
    ? `<b>ICT bullish displacement screener (CoinDCX) — ${stamp}</b>\n\n` +
      mdScans.map((s) => sectionFor(s.tf.label, s.dispHits, fmtDispRow, 'Displacements')).join('\n\n') + '\n\n' +
      `Body ≥ ${DISPLACEMENT_MULT}× ATR(${ATR_LENGTH}), bullish candle`
    : null;

  const retracementMessage = retrScans.length
    ? `<b>50% / 61.8% retracement screener (CoinDCX) — ${stamp}</b>\n\n` +
      retrScans.map((s) => `<b>— ${s.tf.label} —</b>\n` + (s.retracementHits.length
        ? `<b>Retracements (${s.retracementHits.length})</b>\n\n${fmtRetraceGroups(s.retracementHits)}`
        : 'none')).join('\n\n') + '\n\n' +
      `Within ${RETRACEMENT_DIST_PCT}% of the 50% / 61.8% level of the latest swing leg · ▲ up-leg · ▼ down-leg · ` +
      `legs: ${[RETRACEMENT_DIRECTION_ENABLED.bull && 'bull', RETRACEMENT_DIRECTION_ENABLED.bear && 'bear'].filter(Boolean).join(' + ')}`
    : null;

  for (const m of [momentumMessage, displacementMessage, retracementMessage]) {
    if (m) console.log('\n' + m.replace(/<\/?[a-z]+>/g, ''));
  }

  // Three separate bots, per screen - matching MOMENTUM_/DISPLACEMENT_/
  // RETRACEMENT_ prefixed env var names on both sides (see
  // .github/workflows/screener.yml). Each send is isolated so one bot
  // failing doesn't stop the others; the run still exits non-zero at the end
  // if any send failed.
  const sends = [];
  if (momentumMessage) {
    sends.push({ label: 'Momentum', text: momentumMessage, token: process.env.MOMENTUM_TELEGRAM_BOT_TOKEN, chatId: process.env.MOMENTUM_TELEGRAM_CHAT_ID });
  }
  if (displacementMessage) {
    sends.push({ label: 'Displacement', text: displacementMessage, token: process.env.DISPLACEMENT_TELEGRAM_BOT_TOKEN, chatId: process.env.DISPLACEMENT_TELEGRAM_CHAT_ID });
  }
  if (retracementMessage) {
    sends.push({ label: 'Retracement', text: retracementMessage, token: process.env.RETRACEMENT_TELEGRAM_BOT_TOKEN, chatId: process.env.RETRACEMENT_TELEGRAM_CHAT_ID });
  }

  const failures = [];
  for (const { label, text, token, chatId } of sends) {
    try {
      await sendTelegramMessage(text, token, chatId, label);
    } catch (e) {
      console.error(`${label} send failed:`, e.message);
      failures.push(label);
    }
  }
  if (failures.length) throw new Error(`Telegram send failed for: ${failures.join(', ')}`);
}

main().catch((err) => {
  console.error('Screener run failed:', err);
  process.exit(1);
});
