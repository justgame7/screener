// Builds predictions.json for TradeSphere's Prediction Markets page: the prediction-market odds
// that matter most for crypto, from Kalshi (macro, rates, crypto prices) and Polymarket (crypto
// policy / regulation / big crypto questions).
//
// Why these markets: crypto trades as a high-beta macro asset. In rough order of impact it reacts
// to Fed policy and liquidity, the inflation and jobs data that drive the Fed, the dollar and
// yields, broad risk appetite (equities, gold), crypto-specific policy, and its own price levels.
// Each series below carries an impact rating (3 = high) and a one-line "why" shown on the page.
//
// Output: { v, updated, took_ms, diag, events: [...] } written to ../data/predictions.json.
// `diag` records, per series, whether anything came back, so a dead or renamed ticker shows up
// in the file instead of silently disappearing. Missing series never fail the run.
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.env.PRED_OUT || path.join(__dirname, '..', 'data', 'predictions.json');
const KALSHI_HOSTS = ['https://external-api.kalshi.com/trade-api/v2', 'https://api.elections.kalshi.com/trade-api/v2'];
const POLY = 'https://gamma-api.polymarket.com';
const UA = 'tradesphere-dashboard/1.0 (+https://github.com/justgame7/screener)';

// theme: fed | infl | jobs | mkts | crypto | policy
// unit:  '%' | '$' | 'n' (count) | 'pts' | 'fx' | null (yes/no or named outcomes)
// n:     how many upcoming events of the series to keep (default 1)
// pick:  'next' (soonest closing) or 'vol' (most traded among those closing within withinH hours)
const SERIES = [
  // ---- Fed & liquidity ----
  { s: 'KXFEDDECISION', name: 'Next Fed decision', theme: 'fed', imp: 3, unit: null, n: 2,
    why: 'The biggest scheduled event for crypto. Cuts loosen financial conditions and weaken the dollar (tailwind); hikes or a hawkish hold drain liquidity (headwind).' },
  { s: 'KXFED', name: 'Fed funds rate', theme: 'fed', imp: 3, unit: '%', n: 3,
    why: 'Where traders see the policy rate after upcoming meetings. A falling path means cheaper money chasing risk assets like BTC.' },
  { s: 'KXRATECUTCOUNT', name: 'Fed cuts this year', theme: 'fed', imp: 3, unit: 'n',
    why: 'Total easing priced for the year. More cuts priced = more liquidity expected, historically supportive for crypto.' },
  { s: 'KXRATEHIKE', name: 'Fed hikes this year', theme: 'fed', imp: 3, unit: 'n',
    why: 'Odds the Fed has to tighten again. Rising hike odds are one of the clearest macro headwinds for crypto.' },
  { s: 'KXEMERCUTS', name: 'Emergency rate cut', theme: 'fed', imp: 2, unit: null,
    why: 'Tail risk: an emergency cut usually means a market crisis first (risk-off), then a flood of liquidity.' },
  { s: 'KXBALANCESHEET', name: 'Fed balance sheet', theme: 'fed', imp: 2, unit: null,
    why: 'Balance-sheet growth adds dollar liquidity to the system, which crypto tends to follow with a lag.' },
  { s: 'KXQTEND', name: 'QT ending', theme: 'fed', imp: 2, unit: null,
    why: 'Quantitative tightening drains liquidity; its end removes a steady headwind for risk assets.' },

  // ---- Inflation ----
  { s: 'KXCPI', name: 'CPI (m/m)', theme: 'infl', imp: 3, unit: '%',
    why: 'Hot inflation pushes cuts further out and lifts the dollar and yields, which often hits BTC on release day.' },
  { s: 'KXCPIYOY', name: 'CPI (y/y)', theme: 'infl', imp: 3, unit: '%',
    why: 'Headline inflation trend the Fed is steering against. Cooling inflation opens the door to cuts.' },
  { s: 'KXCPICOREYOY', name: 'Core CPI (y/y)', theme: 'infl', imp: 2, unit: '%',
    why: 'Core inflation strips out food and energy, so it is what the Fed watches most closely.' },
  { s: 'KXPCECORE', name: 'Core PCE', theme: 'infl', imp: 2, unit: '%',
    why: "The Fed's preferred inflation gauge; surprises move rate-cut odds and crypto with them." },
  { s: 'KXUSPPI', name: 'PPI (m/m)', theme: 'infl', imp: 1, unit: '%',
    why: 'Producer prices lead consumer inflation; a hot print can front-run a hot CPI.' },

  // ---- Jobs & growth ----
  { s: 'KXPAYROLLS', name: 'Nonfarm payrolls', theme: 'jobs', imp: 3, unit: 'n',
    why: 'Jobs day is a top volatility event. Weak jobs raise cut odds (liquidity tailwind) unless they signal recession.' },
  { s: 'KXU3', name: 'Unemployment rate', theme: 'jobs', imp: 3, unit: '%',
    why: 'Rising unemployment pressures the Fed to ease; too fast a rise means recession fears and risk-off.' },
  { s: 'KXRECSSNBER', name: 'US recession', theme: 'jobs', imp: 3, unit: null, n: 2,
    why: 'Recessions hit risk assets first; the easing that follows has historically fueled the next crypto rally.' },
  { s: 'KXGDP', name: 'GDP growth', theme: 'jobs', imp: 2, unit: '%',
    why: 'Growth sets the backdrop for risk appetite and for how much room the Fed has to cut.' },
  { s: 'KXJOBLESSCLAIMS', name: 'Jobless claims', theme: 'jobs', imp: 1, unit: 'n',
    why: 'Weekly, real-time read on the labour market between payroll reports.' },
  { s: 'KXISMPMI', name: 'ISM manufacturing', theme: 'jobs', imp: 1, unit: null,
    why: 'Business-cycle gauge; crypto has tracked the ISM cycle closely in past cycles.' },

  // ---- Rates, dollar & markets ----
  { s: 'KXTNOTEW', name: '10Y yield (week)', theme: 'mkts', imp: 2, unit: '%',
    why: 'Higher Treasury yields raise the opportunity cost of holding non-yielding BTC.' },
  { s: 'KXNOTE10M', name: '10Y yield (month)', theme: 'mkts', imp: 2, unit: '%',
    why: 'Month-end view on long rates; a falling 10Y usually supports risk assets.' },
  { s: 'KXINXW', name: 'S&P 500 (week)', theme: 'mkts', imp: 2, unit: 'pts', pick: 'vol', withinH: 24 * 8,
    why: 'BTC has traded with a strong positive correlation to US stocks; equity risk-off usually drags crypto.' },
  { s: 'KXNASDAQ100W', name: 'Nasdaq-100 (week)', theme: 'mkts', imp: 2, unit: 'pts', pick: 'vol', withinH: 24 * 8,
    why: 'Tech/growth stocks are the closest equity cousin of crypto by risk profile.' },
  { s: 'KXUSDJPYW', name: 'USD/JPY (week)', theme: 'mkts', imp: 1, unit: 'fx',
    why: 'A sharp yen rally can unwind the carry trade (as in Aug 2024) and force selling across risk assets.' },
  { s: 'KXGOLD', name: 'Gold (daily)', theme: 'mkts', imp: 1, unit: '$', pick: 'vol', withinH: 36,
    why: 'Gold is the store-of-value benchmark BTC competes with; the two often move on the same debasement theme.' },
  { s: 'KXOILW', name: 'Oil (week)', theme: 'mkts', imp: 1, unit: '$',
    why: 'Oil feeds inflation expectations, and with them the rate path.' },

  // ---- Crypto prices ----
  { s: 'KXBTCD', name: 'Bitcoin daily close', theme: 'crypto', imp: 3, unit: '$', pick: 'vol', withinH: 36,
    why: "Where traders put today's BTC settlement. The 50% line is the market's median expected price." },
  { s: 'KXETHD', name: 'Ethereum daily close', theme: 'crypto', imp: 2, unit: '$', pick: 'vol', withinH: 36,
    why: 'Median expected ETH settlement for the day.' },
  { s: 'KXSOLD', name: 'Solana daily', theme: 'crypto', imp: 1, unit: '$', pick: 'vol', withinH: 36,
    why: 'Expected SOL settlement range for the day.' },
  { s: 'KXXRPD', name: 'XRP daily', theme: 'crypto', imp: 1, unit: '$', pick: 'vol', withinH: 36,
    why: 'Expected XRP settlement range for the day.' },
  { s: 'KXBTCMAXM', name: 'BTC high this month', theme: 'crypto', imp: 2, unit: '$',
    why: 'Odds BTC touches each level before month-end: the market-implied upside.' },
  { s: 'KXBTCMINMON', name: 'BTC low this month', theme: 'crypto', imp: 2, unit: '$',
    why: 'Odds BTC trades down to each level before month-end: the market-implied downside.' },
  { s: 'KXBTCMAXY', name: 'BTC high this year', theme: 'crypto', imp: 2, unit: '$',
    why: 'Year-end upside the market is willing to pay for.' },
  { s: 'KXBTCMINY', name: 'BTC low this year', theme: 'crypto', imp: 2, unit: '$',
    why: 'How deep traders think BTC can still fall this year.' },
  { s: 'KXETHMAXMON', name: 'ETH high this month', theme: 'crypto', imp: 1, unit: '$',
    why: 'Market-implied ETH upside for the month.' },
  { s: 'KXBTCDOM', name: 'BTC dominance', theme: 'crypto', imp: 1, unit: '%',
    why: 'Falling BTC dominance is the classic signal of an altcoin season.' },
  { s: 'KXBTCVSGOLD', name: 'BTC vs gold', theme: 'crypto', imp: 1, unit: null,
    why: 'Whether "digital gold" beats physical gold over the period.' },

  // ---- Crypto & policy ----
  { s: 'KXUSDTMIN', name: 'USDT de-peg', theme: 'policy', imp: 2, unit: null,
    why: 'Tether is the main dollar rail of crypto; a de-peg would be a systemic shock.' },
  { s: 'KXUSDCMIN', name: 'USDC de-peg', theme: 'policy', imp: 2, unit: null,
    why: 'USDC backs much of DeFi and US on-ramps; a de-peg (as in Mar 2023) hits the whole market.' },
  { s: 'KXMSTRSELL', name: 'Strategy sells BTC', theme: 'policy', imp: 2, unit: null,
    why: 'The largest corporate holder selling would break a key source of structural demand.' },
  { s: 'KXBTCRESERVECOUNTRY', name: 'Countries with BTC reserves', theme: 'policy', imp: 1, unit: 'n',
    why: 'Sovereign adoption adds long-term demand and legitimacy.' },
  { s: 'KXCOUNTRYBTC', name: 'Country buying BTC', theme: 'policy', imp: 1, unit: null,
    why: 'Nation-state buying is a structural demand story.' },
  { s: 'KXSTABLECOINGENIUS', name: 'Stablecoin approvals', theme: 'policy', imp: 1, unit: null,
    why: 'Regulated stablecoin issuance grows the on-chain dollar base that flows into crypto.' },
];

// Polymarket: crypto-tagged events, ranked by 24h volume. Short-dated price coin-flips are skipped
// (Kalshi already covers prices); what is left is mostly policy, regulation, ETFs, reserves and
// big multi-month crypto questions.
const POLY_TAGS = ['crypto'];
const POLY_MAX = 24;
const POLY_MIN_DAYS = 3;
const POLY_SKIP = /\bup or down\b|\b(5|15)\s*(min|minute)/i;
const POLY_PRICE = /\b(price|above|below|reach|hit|dip|ath|all[- ]time high|\$\s?\d)/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };

async function getJSON(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.status === 404) return { __404: true };
      if (r.status === 429 || r.status >= 500) { last = new Error('HTTP ' + r.status); await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; await sleep(1000 * (i + 1)); }
  }
  throw last;
}

// ---------- Kalshi ----------
let kalshiHost = KALSHI_HOSTS[0];
async function kalshi(pathAndQuery) {
  try { return await getJSON(kalshiHost + pathAndQuery); }
  catch (e) {
    const alt = KALSHI_HOSTS.find(h => h !== kalshiHost);
    const j = await getJSON(alt + pathAndQuery); // throws if both fail
    kalshiHost = alt;
    return j;
  }
}

async function seriesMarkets(ticker) {
  const out = []; let cursor = '';
  for (let page = 0; page < 6; page++) {
    const j = await kalshi(`/markets?series_ticker=${encodeURIComponent(ticker)}&status=open&limit=1000${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (j.__404) break;
    out.push(...(j.markets || []));
    cursor = j.cursor || '';
    if (!cursor || !(j.markets || []).length) break;
    await sleep(350);
  }
  return out;
}

// Event-level titles ("Fed decision in December 2026?") read better than a single strike's question.
async function seriesEventTitles(ticker) {
  const titles = new Map();
  try {
    const j = await kalshi(`/events?series_ticker=${encodeURIComponent(ticker)}&status=open&limit=200`);
    for (const e of (j && j.events) || []) {
      const t = [e.title, e.sub_title].filter(Boolean).join(' · ');
      if (t) titles.set(e.event_ticker, t);
    }
  } catch (e) { /* fall back to market titles */ }
  return titles;
}
const clean = s => String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

// Probability a Kalshi YES contract pays: tight-quote midpoint, else last trade, else loose midpoint.
function kProb(bid, ask, last) {
  if (bid != null && ask != null && ask > 0 && ask - bid <= 0.10) return { p: (bid + ask) / 2, tight: true };
  if (last != null && last > 0) return { p: last, tight: false };
  if (bid != null && ask != null && ask > 0) return { p: (bid + ask) / 2, tight: false };
  return null;
}

function kalshiOutcome(m) {
  const bid = num(m.yes_bid_dollars), ask = num(m.yes_ask_dollars), last = num(m.last_price_dollars);
  const pr = kProb(bid, ask, last);
  if (!pr) return null;
  const pb = num(m.previous_yes_bid_dollars), pa = num(m.previous_yes_ask_dollars), pl = num(m.previous_price_dollars);
  const p0 = kProb(pb, pa, pl);
  return {
    l: m.yes_sub_title || m.subtitle || m.ticker,
    st: m.strike_type || null,
    k: num(m.floor_strike), k2: num(m.cap_strike),
    p: round(pr.p, 4), p0: p0 ? round(p0.p, 4) : null, tight: pr.tight,
    v: num(m.volume_fp) || 0, v24: num(m.volume_24h_fp) || 0, oi: num(m.open_interest_fp) || 0,
  };
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// Classify an event's market set and trim long ladders to the informative part.
function shapeOutcomes(outs) {
  if (outs.length === 1) return { kind: 'binary', out: outs };
  const above = outs.filter(o => (o.st === 'greater' || o.st === 'greater_or_equal') && o.k != null);
  const below = outs.filter(o => (o.st === 'less' || o.st === 'less_or_equal') && o.k2 != null);
  const between = outs.filter(o => o.st === 'between' && o.k != null && o.k2 != null);
  if (above.length >= 3 && above.length >= outs.length * 0.6) {
    above.sort((a, b) => a.k - b.k);
    return { kind: 'ladder', out: trimLadder(above) };
  }
  if (below.length >= 3 && below.length >= outs.length * 0.6) {
    // "Below X" ladder (e.g. how low will BTC go): keep as-is, sorted high to low strike.
    below.sort((a, b) => b.k2 - a.k2);
    return { kind: 'below', out: trimLadder(below) };
  }
  if (between.length >= 3 && between.length >= outs.length * 0.6) {
    between.sort((a, b) => a.k - b.k);
    return { kind: 'range', out: between.filter(o => o.p >= 0.005 || o.v24 > 0).slice(0, 40) };
  }
  outs.sort((a, b) => b.p - a.p);
  return { kind: 'multi', out: outs.slice(0, 12) };
}
function trimLadder(rows) {
  let lo = rows.findIndex(r => r.p < 0.99), hi = rows.length - 1;
  while (hi > 0 && rows[hi].p <= 0.01) hi--;
  if (lo < 0) lo = rows.length - 1;
  const a = Math.max(0, Math.min(lo, hi) - 1), b = Math.min(rows.length - 1, Math.max(lo, hi) + 1);
  let cut = rows.slice(a, b + 1);
  if (cut.length > 40) { const step = Math.ceil(cut.length / 40); cut = cut.filter((_, i) => i % step === 0); }
  return cut;
}

async function buildKalshi(diag) {
  const events = [];
  const now = Date.now();
  for (const cfg of SERIES) {
    const d = diag[cfg.s] = { ok: false, markets: 0, events: 0 };
    try {
      const ms = await seriesMarkets(cfg.s);
      d.markets = ms.length;
      const titles = ms.length ? await seriesEventTitles(cfg.s) : new Map();
      const byEv = new Map();
      for (const m of ms) {
        const c = Date.parse(m.close_time);
        if (!(c > now)) continue;
        if (!byEv.has(m.event_ticker)) byEv.set(m.event_ticker, []);
        byEv.get(m.event_ticker).push(m);
      }
      let evs = [...byEv.entries()].map(([id, list]) => ({
        id, list, close: Math.min(...list.map(m => Date.parse(m.close_time))),
        v24: list.reduce((a, m) => a + (num(m.volume_24h_fp) || 0), 0),
        vol: list.reduce((a, m) => a + (num(m.volume_fp) || 0), 0),
      }));
      evs.sort((a, b) => a.close - b.close);
      if (cfg.pick === 'vol') {
        const win = evs.filter(e => e.close - now <= (cfg.withinH || 36) * 3600e3);
        evs = (win.length ? win : evs).slice().sort((a, b) => (b.v24 - a.v24) || (b.vol - a.vol) || (a.close - b.close));
      }
      for (const e of evs.slice(0, cfg.n || 1)) {
        const outs = e.list.map(kalshiOutcome).filter(Boolean);
        if (!outs.length) continue;
        const shaped = shapeOutcomes(outs);
        const first = e.list[0];
        events.push({
          id: e.id, src: 'kalshi', series: cfg.s, name: cfg.name, theme: cfg.theme, imp: cfg.imp, unit: cfg.unit, why: cfg.why,
          url: 'https://kalshi.com/markets/' + cfg.s.toLowerCase(),
          title: clean(titles.get(e.id) || first.title || cfg.name), close: new Date(e.close).toISOString(),
          kind: shaped.kind, out: shaped.out,
          vol: Math.round(e.vol), vol24: Math.round(e.v24),
          oi: Math.round(e.list.reduce((a, m) => a + (num(m.open_interest_fp) || 0), 0)),
        });
        d.events++;
      }
      d.ok = d.events > 0;
    } catch (err) {
      d.err = String(err && err.message || err);
    }
    await sleep(400);
  }
  return events;
}

// ---------- Polymarket ----------
function parseArr(v) { if (Array.isArray(v)) return v; try { return JSON.parse(v || '[]'); } catch { return []; } }

async function buildPolymarket(diag) {
  const events = [];
  const seen = new Set();
  const now = Date.now();
  for (const slug of POLY_TAGS) {
    const d = diag['tag:' + slug] = { ok: false, events: 0 };
    try {
      const tag = await getJSON(`${POLY}/tags/slug/${slug}`);
      if (!tag || tag.__404 || !tag.id) throw new Error('tag not found');
      const list = await getJSON(`${POLY}/events?tag_id=${tag.id}&active=true&closed=false&order=volume24hr&ascending=false&limit=150`);
      const arr = Array.isArray(list) ? list : (list.data || list.events || []);
      d.fetched = arr.length;
      const cands = arr
        .filter(e => e && !seen.has(e.id) && !POLY_SKIP.test(e.title || ''))
        .filter(e => { const end = Date.parse(e.endDate); return !(end > 0) || end - now > POLY_MIN_DAYS * 864e5; })
        .sort((a, b) => (num(b.volume24hr) || 0) - (num(a.volume24hr) || 0));
      for (const e of cands) {
        if (events.length >= POLY_MAX) break;
        const ms = (e.markets || []).filter(m => m.active !== false && m.closed !== true);
        const out = [];
        for (const m of ms) {
          const prices = parseArr(m.outcomePrices).map(num), names = parseArr(m.outcomes);
          let p = prices[0];
          const bid = num(m.bestBid), ask = num(m.bestAsk);
          const tight = bid != null && ask != null && ask > 0 && ask - bid <= 0.10;
          if (tight) p = (bid + ask) / 2;
          if (p == null) continue;
          const ch = num(m.oneDayPriceChange);
          out.push({
            l: ms.length > 1 ? (m.groupItemTitle || m.question) : (names[0] || 'Yes'),
            p: round(p, 4), p0: ch != null ? round(Math.min(1, Math.max(0, p - ch)), 4) : null, tight,
            v: num(m.volumeNum ?? m.volume) || 0, v24: num(m.volume24hr) || 0, oi: 0,
          });
        }
        if (!out.length) continue;
        out.sort((a, b) => b.p - a.p);
        seen.add(e.id);
        const title = clean(e.title || (ms[0] && ms[0].question) || 'Polymarket event');
        events.push({
          id: 'pm-' + e.id, src: 'polymarket', series: 'PM:' + (e.slug || e.id),
          name: POLY_PRICE.test(title) ? 'Crypto price question' : 'Crypto policy & events',
          theme: POLY_PRICE.test(title) ? 'crypto' : 'policy',
          imp: (num(e.volume24hr) || 0) > 250000 ? 2 : 1, unit: null, why: null,
          url: 'https://polymarket.com/event/' + (e.slug || ''),
          title, close: e.endDate ? new Date(e.endDate).toISOString() : null,
          kind: out.length === 1 ? 'binary' : 'multi', out: out.slice(0, 12),
          vol: Math.round(num(e.volume) || 0), vol24: Math.round(num(e.volume24hr) || 0), oi: Math.round(num(e.liquidity) || 0),
        });
        d.events++;
      }
      d.ok = d.events > 0;
    } catch (err) {
      d.err = String(err && err.message || err);
    }
  }
  return events;
}

(async () => {
  const t0 = Date.now();
  const diag = { kalshi: {}, polymarket: {} };
  const k = await buildKalshi(diag.kalshi);
  const p = await buildPolymarket(diag.polymarket);
  diag.kalshi_host = kalshiHost;
  const out = { v: 1, updated: new Date().toISOString(), took_ms: Date.now() - t0, diag, events: [...k, ...p] };
  const okK = Object.values(diag.kalshi).filter(d => d.ok).length;
  console.log(`kalshi: ${okK}/${SERIES.length} series, ${k.length} events · polymarket: ${p.length} events · ${out.took_ms} ms`);
  for (const [s, d] of Object.entries(diag.kalshi)) if (!d.ok) console.log(`  no data: ${s}${d.err ? ' (' + d.err + ')' : ''}`);
  if (!k.length && !p.length) { console.error('Nothing fetched; keeping the previous file.'); process.exit(1); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
})();
