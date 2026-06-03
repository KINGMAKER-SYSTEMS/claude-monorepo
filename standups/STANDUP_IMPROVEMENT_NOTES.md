# Standup Improvement Notes

_Running log of what's worked and what hasn't for the morning-stand-up scheduled task. Created locally 2026-06-03 because the scheduled-task prompt referenced this file but it did not exist in this worktree (it likely lived only on a KINGMAKER PR branch). Local-first per the 6/02 TODO._

## What works (keep doing)

- **Brain MCP is down and has been since ~4/28 (15+ standups).** Do not block on it. Compose from live `gh` + `git` + Linear + Gmail. The fix lives in this monorepo's `indexer/` (uncommitted scanner diff on the gitbutler workspace) — it's a known carry, not news.
- **72h Gmail window + the `+cc` daily brief as a second source.** As of 6/03 the raw email scan and the `+cc` brief fully agree on security items. Pull both, cross-check. The brief is reliable for surfacing time-boxed personal items (IPO deadlines, trials) the raw scan deprioritizes.
- **`gh api .../secret-scanning/alerts` to verify security work orders.** Caught WO-07 still-open on 6/03. Don't trust "we filed a WO" as "it's handled" — re-verify the underlying alert state each run.
- **Headless write-ceiling is real.** The standup can find, file (work orders), and do Tier-B safe git ops (rebase a stale PR via an isolated agent, as 6/02 did with PR #43). It canNOT: merge PRs (denied 5/29 + 6/01), push someone's uncommitted local edits, rotate keys, touch billing, or write prod RLS policies. Classify those as NEEDS-JOHN and move on.

## What hasn't worked (stop / change)

- **Auto-merging the standup's own docs-only PRs** — DENIED 5/29 and 6/01. Stopped attempting 6/01; confirmed hardened 6/02/6/03. The scoped-permission rule (see TODO #3) is the only real fix; until granted, log directly.
- **Promoting the Codex-stuck outreach tickets in the standup** — 7 consecutive mornings (as of 6/03), zero movement. The standup is invisible to John on this item. Needs a non-standup channel (TODO #4).
- **`gh api notifications` as a freshness signal** — unreliable once bulk-marked-read (stale since 5/20). Use `gh search prs --updated >=` windows instead.

## Open pipeline TODOs (carried)

1. Local-first standup write (the PR is a side-effect). _Half-held._
2. **NEW 6/03:** Reconcile the `standups/instructions/*.md` references in the scheduled-task prompt — they don't exist in this worktree. Either codify them or stop pointing at them.
3. Scoped auto-merge rule for docs-only standup PRs. _3rd carry._
4. Codex-stuck non-standup escalation (Slack/iMessage/push). _6th ask._
5. **NEW 6/03:** Make secret-scanning + Supabase-advisor polling a first-class gather step, not an email side-effect. Security is now the standup's lede.
6. Carryover counter as code (`grep -c` over `standups/*.md`).
7. Deploy-SHA drift probe (Railway/Vercel/CF). _Unexercised._
8. sync-upstream silence verification (2+ weeks quiet — fixed or deleted?).

## Work order ledger

| WO | Filed | Subject | State as of 6/03 |
|----|-------|---------|------------------|
| WO-07 | 6/02 | ocean-surface exposed Google API key | 🔴 alert #1 still OPEN; file actively edited |
| WO-08 | 6/02 | RunPod low balance | 🔴 escalated → volume deletion scheduled |
| WO-09 | 6/03 | Supabase `tracker-auth` RLS / sensitive columns | 🔴 new, open |

## 2026-06-03 (supplement run)

- **OBSERVATION:** First run probed only the brain MCP tool and got "Command failed with no output," then stopped. The underlying CLI (`~/Library/pnpm/brain doctor`) was never invoked. CLI throws `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@brain/daemon' imported from packages/cli/src/commands/watch.ts` — a fully diagnostic error that points at the workspace not being linked.
- **FIX:** When the brain MCP tool returns "no output," the gather phase should fall through to the CLI before declaring DEGRADED. The CLI surfaces the real root cause; the MCP wrapper swallows it.
- **VALIDATED:** Pending — apply to tomorrow's run.

- **OBSERVATION:** iMessage was dropped from canonical pulls 14+ standups ago. Supplement run pulled it anyway and immediately caught a Comcast outage heads-up for 6/04 — directly affects tomorrow's standup feasibility.
- **FIX:** Reinstate iMessage in canonical, bounded to last 24h, no allowlist filter. If signal-to-noise tanks again over 7 runs, re-evaluate then.
- **VALIDATED:** Today's run, yes — signal-positive on first re-pull.

- **OBSERVATION:** First run trusted the `+cc` brief on the Obsidian-Pi-Agent missing-module claim. Supplement run verified via `gh api repos/.../contents/scripts/lib/` and confirmed the brief was correct, but the API receipt is the proof.
- **FIX:** For any LIVE-classified security/prod-class claim sourced from `+cc`, gather phase should perform an independent verification (gh api, supabase advisors, direct git/grep). If verification fails or contradicts, downgrade or flag for John.
- **VALIDATED:** Pending — but supplement run's discipline here is the model.

- **OBSERVATION:** 22 historical standup files are untracked in `~/dev/claude-monorepo/standups/` on the main worktree's `gitbutler/workspace` branch. Each scheduled-task run spawns its own worktree and PRs upward, so no run ever lands the file on main locally.
- **FIX:** Two options. (a) The scheduled task writes to the main worktree's `standups/` via absolute path before exiting; or (b) a one-time `git add standups/ && git commit` on the main worktree, then trust the PR flow going forward. Prefer (a) — defends against future drift.
- **VALIDATED:** Pending.
