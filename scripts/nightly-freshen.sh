#!/usr/bin/env bash
# nightly-freshen.sh — re-summarize stale projects and refine new open loops.
# Intended for a nightly cron or a LaunchAgent StartCalendarInterval.
#
# Example crontab entry (runs 03:30 local every day):
#   30 3 * * * cd /path/to/claude-monorepo && ./scripts/nightly-freshen.sh >> ~/.local/state/brain/freshen.log 2>&1
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "[freshen $(date -Iseconds)] start"

pnpm brain scan           # refresh git/manifest/transcript state + derive alerts
pnpm brain summarize      # LLM summary for projects whose fingerprint changed
pnpm brain refine         # rewrite messy open loops

echo "[freshen $(date -Iseconds)] done"
