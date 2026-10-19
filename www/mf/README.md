# MF Screener

Client-side mutual fund screener (single `index.html`, no build, no backend).
Live NAV history from [mfapi.in](https://www.mfapi.in) (AMFI data); all metrics are computed in the browser.

## Screening settings
Six checks from the video (each toggleable, thresholds editable): Max Drawdown < 30 · 1Y return > 0 · Away from ATH < 10 · 3Y avg rolling return > 20 · Top-3 holdings < 40 · Cash < 5. Top-3 and cash are entered manually in the table (no free API).

Plus a composite score, "1 Crore" presets, per-fund detail with a SIP planner.

## Run
Open `index.html`, or serve it (GitHub Pages: root).  `python -m http.server`

Not investment advice. Expense ratio/AUM are not in the NAV feed.

## Security
- Strict Content-Security-Policy (`<meta>` in `index.html`): scripts only from this origin (no inline JS, which lives in `app.js`), network calls only to this origin and `api.mfapi.in`, no frames/objects, no `<base>`, no form posts.
- `referrer` policy `strict-origin-when-cross-origin`; external links use `rel="noopener noreferrer"`.
- All fund text is HTML-escaped before rendering; scheme codes are validated as integers before use in URLs; anything read back from `localStorage` is shape-checked and falls back to defaults.
- Service worker only handles same-origin requests and never caches third-party responses.
- GitHub Action runs with least-privilege `permissions`, no secrets are used, and `.env` is git-ignored.
