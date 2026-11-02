# Screener bots

Public repo that runs the data bots, because GitHub Actions minutes are free on public repos. The apps themselves live in their own private repos.

## TradeSphere

Scripts are in `tradesphere/scripts/`, with workflows `ts-*.yml`. cron-job.org triggers them through `workflow_dispatch`. They commit their JSON output to the `tradesphere-data` branch, which the TradeSphere Worker reads.

| Workflow | Script | Runs every |
|---|---|---|
| `ts-alerts.yml` | `donchian-alerts.js` | 5 minutes |
| `ts-hl-liq.yml` | `hl-liq.js` | 30 minutes |
| `ts-kalshi.yml` | `predictions.js` | 10 minutes |

## Telegram screener

`screen.js` (`screener.yml`) is the Telegram momentum, displacement, Donchian and retracement screener. Its schedule is off, so it only runs when triggered by hand.

## IndiSphere

Bots for the IndiSphere app go here too, following the same pattern as TradeSphere.
