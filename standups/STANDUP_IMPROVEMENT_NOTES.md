# Standup Improvement Notes

_Running log of what's worked and what hasn't for the morning-stand-up scheduled task. Created locally 2026-06-03 because the scheduled-task prompt referenced this file but it did not exist in this worktree (it likely lived only on a KINGMAKER PR branch). Local-first per the 6/02 TODO._

## What works (keep doing)

- **Brain MCP is down and has been since ~4/28 (15+ standups).** Do not block on it. Compose from live `gh` + `git` + Linear + Gmail. The fix lives in this monorepo's `indexer/` (uncommitted scanner diff on the gitbutler workspace) — it's a known carry, not news.
- **72h Gmail window + the `+cc` daily brief as a second source.** As of 6/03 the raw email scan and the `+cc` brief fully agree on security items. Pull both, cross-check. The brief is reliable for surfacing time-boxed personal items (IPO deadlines, trials) the raw scan deprioritizes.
- **`gh api .../secret-scanning/alerts` to verify security work orders.** Caught WO-07 still-open on 6/03. Don't trust "we filed a WO" as "it's handled" — re-verify the underlying alert state each run.
- **Headless write-ceiling is real.** The standup can find, file (work orders), and do Tier-B safe git ops (rebase a stale PR via an isolated agent, as 6/02 did with PR #43). It canNOT: merge PRs (denied 5/29 + 6/01), push someone's uncommitted local edits, rotate keys, touch billing, or write prod RLS policies. Classify those as NEEDS-JOHN and move on.

## 2026-06-05 additions

- **VERIFY loss-risk carryovers before re-promoting them.** Two items that had been promoted for 10+ standups (content-posting-lab `[gone]` WIP, campaign-hub "111 ahead") both turned out to be **resolved/false** the moment they were checked live: the content-posting-lab branch still exists at `927ed19` and its work shipped as merged PR #46; the campaign-hub "111 ahead" was `--left-right` diverged-upstream noise (`origin/main..HEAD` = 0). Lesson: a carryover is a *hypothesis*, not a fact — re-verify each one with a live command before writing it again, or it rots into permanent false-alarm noise.
- **🆕 Privacy: scrub PII from iMessage-sourced lines before writing.** The 6/03 supplement leaked a third-party phone number into PR #17 (caught by the 6/04 `+cc` brief, confirmed via `git grep`). iMessage gives real contact info; never copy raw phone numbers / handles into a committed standup. Redact at write time.
- **Live `get_advisors` beats remembered advisor state.** The 6/03 run framed the Supabase item as "live auth-DB PII." Today's live pull showed it's actually `public.campaign_invites.token` (invite tokens), a lower-severity integrity hole. Pull the advisor fresh each run and pin the *exact table + column* — don't carry a vague severity claim forward.

## 2026-06-05 (supplement run, ~19:45 UTC) additions

- **✅ Phantom instruction files CLOSED.** The 4-standup carryover (`standups/instructions/*.md` referenced by the task prompt but never existing) is fixed: this run codified `00-charter`, `10-gather`, `20-act`, `30-no-touch`, `40-output` from the de-facto process. Future runs read real files. TODO #2 retired.
- **The supplement re-verify pass paid off again.** Every carryover re-checked live: content-posting-lab branch still at `927ed19` (safe), campaign-hub `origin/main..HEAD`=0 (still false alarm), WO-09 advisor unchanged, WO-07 alert still open. One escalation found *only because* of the live check: ocean-surface moved to a new branch `feat/voice-agent-first-class` (20 commits, unpushed) and **carried the hardcoded key forward** — the leaked string is still in the working tree. Re-verify catches drift in both directions.
- **The Codex-stuck diagnosis sharpened into a thesis.** Today John filed + shipped 8 ocean-os tickets (PRs #33-#39) hands-on in ~40 min — proving he *will* burn down Linear work he owns directly. The SALE-67/69/68 + OCEAN-8 outreach tickets (9th standup idle) are Codex-*delegated*; the delegation is the dead-letter box, not the work. The fix is re-routing the delegate, not another standup line. Strongest evidence yet for TODO #4.
- **Brain is now 18 days down**, still one `pnpm install` away, still NEEDS-JOHN (Tier-C). No change.

## What hasn't worked (stop / change)

- **Auto-merging the standup's own docs-only PRs** — DENIED 5/29 and 6/01. Stopped attempting 6/01; confirmed hardened 6/02/6/03. The scoped-permission rule (see TODO #3) is the only real fix; until granted, log directly.
- **Promoting the Codex-stuck outreach tickets in the standup** — 7 consecutive mornings (as of 6/03), zero movement. The standup is invisible to John on this item. Needs a non-standup channel (TODO #4).
- **`gh api notifications` as a freshness signal** — unreliable once bulk-marked-read (stale since 5/20). Use `gh search prs --updated >=` windows instead.

## Open pipeline TODOs (carried)

1. Local-first standup write (the PR is a side-effect). _Half-held._
2. ~~Reconcile the `standups/instructions/*.md` references.~~ **✅ CLOSED 6/05 supplement — files codified.**
3. Scoped auto-merge rule for docs-only standup PRs. _4th carry (9 mergeable PRs now)._
4. Codex-stuck non-standup escalation (Slack/iMessage/push). _7th ask — 9th standup of zero movement._
5. **NEW 6/03:** Make secret-scanning + Supabase-advisor polling a first-class gather step, not an email side-effect. Security is now the standup's lede.
6. Carryover counter as code (`grep -c` over `standups/*.md`).
7. Deploy-SHA drift probe (Railway/Vercel/CF). _Unexercised._
8. sync-upstream silence verification (2+ weeks quiet — fixed or deleted?).

## Work order ledger

| WO | Filed | Subject | State as of 6/05 (supplement) |
|----|-------|---------|------------------|
| WO-07 | 6/02 | ocean-surface exposed Google API key | 🔴 alert #1 still OPEN (5 days). **Escalated:** repo moved to new branch `feat/voice-agent-first-class` (20 commits, unpushed) with the key string STILL in the working tree — carried forward, not removed. Strip before pushing. |
| WO-08 | 6/02 | RunPod low balance | 🔴 still "volume deletion scheduled"; **re-pinged** by fresh email 6/05 13:09 UTC |
| WO-09 | 6/03 | Supabase `tracker-auth` RLS / sensitive columns | 🟠 unchanged from 6/05 correction → `public.campaign_invites`, col `token`; 3 ERROR lints, RLS off; likely 1-line `ALTER TABLE … ENABLE RLS` + smoke-test |

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
