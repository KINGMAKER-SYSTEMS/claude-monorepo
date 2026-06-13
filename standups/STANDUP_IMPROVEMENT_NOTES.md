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

## 2026-06-08 additions (first run of the week)

- **The whole run was a re-verify pass, and that was correct.** No new fires, no Tier-B git work needed → 0 agents, 0 PRs of substance beyond the standup itself. The value was confirming the 3 WOs didn't rot (they didn't) and catching two drifts: (a) ocean-surface's leaked key **migrated from a feature branch into `main`** when `feat/voice-agent-first-class` merged — re-verify caught it moving, not just persisting; (b) ocean-os #141 (P0 OCEAN-185 fix) flipped CI **red→green** overnight (4 failed clippy runs 6/07, latest run passes) — it's now a one-click merge that unblocks a security P0. A static "carry forward" run would have missed both.
- **Security wave is now John-owned, not standup-owned.** 3 live P0 trust-boundary tickets (OCEAN-185, OCEAN-160, CAMP-96) are all In Progress and John-assigned, touched in the last 48h. Correct behavior: confirm they're alive, do NOT file WOs for them, do NOT touch. The standup's security job narrowed to the 3 above-ceiling WOs (key/RLS/billing) John can't or hasn't delegated.
- **Codex-stuck SALE-67 hit its 10th standup of zero movement.** A "Codex application installed in workspace" email landed 6/08 04:33 — another delegation attempt at the same dead-letter box. The thesis from 6/05 holds: the delegation *is* the blocker, not the work. TODO #4 (non-standup escalation channel) is now the single highest-leverage pipeline fix. 10 mornings is enough evidence.
- **iMessage stayed signal-thin but clean.** Unread was ~90% recruitment-scam/phishing spam. 2 benign human texts, neither actionable. PII scrubbed at read time — zero numbers/handles written to the file (the 6/03 PR #17 leak stays a one-time mistake).

## 2026-06-13 additions (Sat catch-up, 3-day gap)

- **The cron is M-F per the SKILL.md but today is Saturday — the runner fired anyway.** The 6/11 and 6/12 (Thu/Fri) runs did NOT fire, but 6/13 (Sat) did. Two policy questions to resolve in cron itself: (a) why did Thu+Fri silently skip when they're explicitly in scope, (b) does the runner *want* weekend coverage or should Sat/Sun be skipped at the cron layer? Today's run found genuine signal (Railway crashes, Runpod deletion, OCEAN-185 closure) so weekend coverage isn't useless — but the M-F mismatch between the skill description and the actual schedule should be reconciled, not papered over. Pipeline TODO: audit the actual cron schedule + add an alert when a scheduled day doesn't run.

- **`+cc` brief lag is a structural pattern, 4th confirmation.** Today's brief led with "Refill Runpod balance to prevent deletion" — but the deletion email arrived 2h 8min *before* the brief (6/13 13:08 UTC deletion vs 11:00 UTC brief). The brief is generated on a fixed schedule from a snapshot; events between snapshot and send can flip it stale. Don't trust the brief as a verb ("refill") — read it as a hypothesis to verify. The standup's job is to cross-check the brief against the underlying source emails (already in the playbook, paid off again today).

- **Railway is still a blind spot.** 5 `ocean-bedrock` crashes in 28h were only visible because Railway sent emails — the standup never pulls the Railway dashboard or deploy status directly. The pipeline TODO #7 (deploy-SHA drift probe) is now actively costing: if email had been the only signal and got filtered, this would have been undetected. **Add a `railway status` / API call for the production services as a canonical gather step.** Especially since `risingtides-content-lab` (6/10) and `ocean-bedrock` (6/13) are *different* services both crashing — Railway-side instability is the actual story, not a per-service blip.

- **Per-worktree drift carryover #3.** Same scaffold-copy dance from sibling worktree as 6/10. The TODO is real and expensive (~30s per run of overhead + risk that a sibling worktree is missing the latest). The fix (land `standups/**` on `main`) keeps not happening because the standup itself can't merge its own PRs. Direct ask to John: grant the scoped auto-merge rule OR run `git merge auto/standup-2026-06-10-supplement` on main locally once and the drift goes away forever.

- **WO-08 ledger lesson: track resolution by outcome, not just by action.** WO-08 closed today not because John acted, but because the volume got deleted. A WO can end three ways: fixed, accepted (loss/risk acknowledged), or closed-by-event (the underlying state changed without intervention). The ledger should distinguish — closed-by-event isn't really a resolution, it's a write-off. Add a small `outcome:` field to WOs: `fixed | accepted | closed-by-event`.

- **The Ocean velocity is real but masks a security signal.** 30 PRs merged in 3 days, all the OCEAN-300s wave, plus closing OCEAN-185 (the 6/08 P0). Meanwhile the WO-07 secret is still sitting in `main.rs:43` after 14 days, and a 30-PR merge wave touched everything *except* that file. **Velocity charts don't capture trust-boundary drift.** The standup's role is to keep that visible — otherwise the sprint optics drown out the persistent security tail.

- **Saturday is a different signal-mix than weekday.** Lower email volume, no GitHub bot CI churn (until John actually pushes), `+cc` brief is shorter and softer ("Enjoy your weekend!"). The standup tone shifted accordingly — fewer "must-do today" framings, more "decide before Mon." Worth codifying as a weekend-mode in the output template if Sat/Sun stays in scope.

## 2026-06-13 (supplement run, 21:46 UTC — duplicate same-evening fire) additions

- **The cron DOUBLE-FIRED 6 minutes apart.** Run 1 committed at 21:40 UTC (PR #22 at 21:44); the scheduled task fired again at 21:46. So the 6/13 cron is broken in *both* directions on the same day: it skipped Thu+Fri (the first run's finding) AND fired a duplicate Saturday evening. The supplement convention saved us — supplement detection found run 1's file, appended deltas, did NOT clobber it — but a 6-minute re-fire is pure wasted compute and produces a near-empty supplement. **Pipeline TODO (new): add a min-interval / dedup guard so a re-trigger inside ~N hours of a *completed* run no-ops instead of generating a vacuous supplement.** Pairs with the existing "audit cron schedule + alert on skipped days" TODO.
- **Quiet-supplement-as-correct-outcome, confirmed again (3rd time: 6/08, 6/10, 6/13).** With a 6-min delta window, the right answer is stasis: WO-07 still open, WO-09 3 lints unchanged, no new Railway/Runpod mail, no new Linear urgent, no new fires. Re-verify-don't-carry still earns its keep even when the answer is "nothing moved" — it's the receipt that nothing rotted, which is the whole point.
- **Supplement detection across worktrees worked without the search dance this time** — the duplicate fired into a worktree whose sibling already held run 1's file (`awesome-williams-1bfcd1`), so the file was found locally. Doesn't retire the per-worktree-drift TODO (landing `standups/**` on main is still the real fix), but worth noting the failure mode (clobbering run 1) didn't trigger.

## 2026-06-10 (supplement run, ~00:30 UTC 6/11) additions

- **This worktree had NO standups/ scaffold; the scheduled-task's referenced instruction paths were missing.** `blissful-kalam-d56614` held only a `.DS_Store` + the monorepo-root `2026-06-08.md`; the instruction files, work-orders, and these notes lived only in *sibling* worktrees (`adoring-chatterjee-0338bc`, `blissful-goldberg-c0f012`). Had to discover + copy them in before running. **This is exactly the per-worktree drift the 6/03 note predicted** — each scheduled run spawns a fresh worktree and the scaffold doesn't follow. Strongest case yet for landing `standups/**` on `main` (option (b) from 6/03) so every worktree branches from a populated tree.
- **Today's FIRST run wrote `2026-06-10.md` into yet another worktree (`agitated-leavitt-5aa642`), not main.** The supplement convention worked (found it, appended deltas, didn't overwrite) — but only because I searched sibling worktrees first. If the search had missed it, the supplement would have clobbered the morning run. **Supplement detection must glob `**/standups/YYYY-MM-DD.md` across worktrees**, not just local `standups/`, until the files land on main.
- **A quiet supplement is a valid, valuable outcome.** ~6h after a 73-PR morning, the correct finding was *stasis*: Ocean sprint asleep (0 new merges), all 3 WOs unchanged, content-posting-lab idle (same commit, not new). The one real delta was the **3rd RunPod deletion ping** (6/10 13:33 UTC), caught only because the supplement re-pulled Gmail. Re-verify earns its keep even on a slow night.
- **GitGuardian 6/09 leak == WO-07, not a new incident.** The first run led with the GitGuardian email as TOP blocker; live secret-scanning API confirms it's the *same* alert #1 / same `main.rs:43` key WO-07 has tracked since 5/31. One leak, two detectors — don't double-count as a fresh fire.

## What hasn't worked (stop / change)

- **Auto-merging the standup's own docs-only PRs** — DENIED 5/29 and 6/01. Stopped attempting 6/01; confirmed hardened 6/02/6/03. The scoped-permission rule (see TODO #3) is the only real fix; until granted, log directly.
- **Promoting the Codex-stuck outreach tickets in the standup** — 7 consecutive mornings (as of 6/03), zero movement. The standup is invisible to John on this item. Needs a non-standup channel (TODO #4).
- **`gh api notifications` as a freshness signal** — unreliable once bulk-marked-read (stale since 5/20). Use `gh search prs --updated >=` windows instead.

## Open pipeline TODOs (carried)

1. Local-first standup write (the PR is a side-effect). _Half-held._
2. ~~Reconcile the `standups/instructions/*.md` references.~~ **✅ CLOSED 6/05 supplement — files codified.**
3. Scoped auto-merge rule for docs-only standup PRs. _4th carry (10 mergeable PRs now)._
4. Codex-stuck non-standup escalation (Slack/iMessage/push). _8th ask — 10th standup of zero movement; Codex app reinstalled 6/08, same dead-letter box._
5. **NEW 6/03:** Make secret-scanning + Supabase-advisor polling a first-class gather step, not an email side-effect. Security is now the standup's lede.
6. Carryover counter as code (`grep -c` over `standups/*.md`).
7. Deploy-SHA drift probe (Railway/Vercel/CF). _Unexercised._
8. sync-upstream silence verification (2+ weeks quiet — fixed or deleted?).

## Work order ledger

| WO | Filed | Subject | State as of 6/08 |
|----|-------|---------|------------------|
| WO-07 | 6/02 | ocean-surface exposed Google API key | 🔴 alert #1 still OPEN (8 days). `feat/voice-agent-first-class` merged → key **carried into `main`** at `crates/ocean-surface-proxy/src/main.rs:43` (`DEFAULT_MAPS_KEY`), `publicly_leaked: true`; `main` has 2 unpushed commits. Strip + rotate before pushing. |
| WO-08 | 6/02 | RunPod low balance | ✅ **CLOSED 6/13 by deletion** — volume deleted 6/13 13:08 UTC after 3 warning pings. Outcome: closed-by-event (not fixed, not accepted). |
| WO-09 | 6/03 | Supabase `campaign_invites` RLS / sensitive columns | 🟠 unchanged → `public.campaign_invites`, col `token`; 3 ERROR lints live (RLS off, 4 policies exist, token exposed via API); likely 1-line `ALTER TABLE … ENABLE RLS` + smoke-test. 11 days open. |

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
