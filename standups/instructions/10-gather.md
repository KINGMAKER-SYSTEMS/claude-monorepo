# 10 — Gather

_The parallel data-pull phase. Run these every standup. Cross-check sources; verify security/prod claims with an independent receipt (API/git), never on a brief's word alone._

## Canonical sources (pull every run)

1. **Live `git status` across all active repos** under `~/dev/`: ocean-os, ocean-agents, ocean-surface, content-posting-lab, risingtides-campaign-hub, rising-tides-agents, rising-tides-course, tidestracker (discover others with `find ~/dev -maxdepth 2 -name .git`). Capture: branch, dirty count, ahead/behind, last-commit age, and **committed-but-unpushed** (`git rev-list --count origin/main..HEAD`) for no-upstream feature branches — that's the real loss-risk signal, not the dirty count.
2. **`gh pr list`** for KINGMAKER-SYSTEMS/claude-monorepo (the standup's own PRs) + each hot repo + `gh search prs --owner Risingtides-dev --state open`.
3. **Security probe (first-class):**
   - `gh api repos/<owner>/<repo>/secret-scanning/alerts` for any repo with a known open alert (currently ocean-surface alert #1).
   - Supabase `get_advisors` (security) for project `tracker-auth` / `imxflhdsfxkfmvsufwvr` and any other live project.
4. **Linear** `list_issues priority=1` (Urgent) — watch for Codex-delegated + stale.
5. **Gmail** — raw scan (72h on a first run, 24h on a supplement) + the `smathdaddy+cc@gmail.com` "Day Ahead" brief. Cross-check the two; they should agree on security items.
6. **iMessage** unread, bounded to the most recent batch. Signal is rare (mostly spam) but has caught real heads-ups (Comcast outage). **Scrub PII at read time** — never copy phone numbers/handles into the file (see `30-no-touch.md`).
7. **Brain self-check:** run the CLI (`~/Library/pnpm/brain doctor`), not just the MCP wrapper — the CLI surfaces the real root cause. Currently `ERR_MODULE_NOT_FOUND: @brain/daemon` (fix = `pnpm install`, but that's NEEDS-JOHN).

## Notes

- `gh api notifications` is unreliable once bulk-marked-read (stale since 5/20). Use `gh search prs --updated >=` windows instead.
- On a **supplement run** (a standup file already exists for today), gather only deltas since the first run's timestamp — don't re-report the morning's state.
- Run the independent pulls in parallel.
