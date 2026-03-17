# Local AI Observability

This setup avoids Braintrust and uses:

- Render deployment logs
- `/debug/events`
- `/debug/conversation/:conversationId`
- local report files under `reports/`

## Required environment variables

```bash
export CLINYCO_DEBUG_BASE_URL="https://clinyco-ai.onrender.com"
export CLINYCO_DEBUG_KEY="your_debug_key"
```

Optional:

```bash
export CLINYCO_DEBUG_LIMIT=200
export CLINYCO_EVAL_GOOD_LIMIT=6
export CLINYCO_EVAL_BAD_LIMIT=6
```

## Run once

```bash
cd /Users/box3/Documents/codex
./scripts/run-ai-observability.sh
```

Outputs:

- `reports/ai-monitor/latest-events.json`
- `reports/ai-monitor/latest-summary.json`
- `reports/ai-monitor/latest-summary.md`
- `reports/ai-monitor/evals/curated-examples-latest.json`
- `reports/ai-monitor/evals/curated-examples-latest.md`

## Cron every 15 minutes

Open crontab:

```bash
crontab -e
```

Add:

```cron
*/15 * * * * export CLINYCO_DEBUG_BASE_URL="https://clinyco-ai.onrender.com"; export CLINYCO_DEBUG_KEY="your_debug_key"; cd /Users/box3/Documents/codex && ./scripts/run-ai-observability.sh >> /Users/box3/Documents/codex/reports/ai-monitor/cron.log 2>&1
```

## Suggested review loop

1. Read `reports/ai-monitor/latest-summary.md`
2. Read `reports/ai-monitor/evals/curated-examples-latest.md`
3. Turn repeated bad patterns into code fixes or prompt rules
4. Re-run after deploys and compare counts
