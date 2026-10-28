# tradesphere-data

Bot-generated JSON for TradeSphere, written by the `ts-*` workflows on `main`
(scripts in `tradesphere/scripts/`). The TradeSphere Cloudflare Worker serves
these files at https://tradesphere.justfagame9.workers.dev/data/<file>.json.

Kept on its own branch so the bots' frequent commits never touch `main`
(no GitHub Pages rebuilds, no push races with the other workflows there).

| File | Written by | Used by |
|---|---|---|
| `donchian-alerts.json`, `alerts-history.json`, `top50.json` | `ts-alerts` | alerts bell, Alerts dashboard |
| `hl-liq.json` | `ts-hl-liq` | Long/Short & Liquidations heatmap |
| `predictions.json` | `ts-kalshi` (`predictions.js`) | Prediction Markets |
