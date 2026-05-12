# Standup Task — Improvement Notes

## What's Working Well

- Brain standup tool gives good project velocity signals (message count, session duration)
- Git dirty state + unpushed commit detection is high-signal for "things left mid-work"
- Email scanning catches live production issues (e.g. TikTok Postiz errors)
- Combining recent sessions with open loops from transcripts gives a "where I left off" narrative

## Current Limitations & How to Fix Them

### 1. No Session Summaries
Brain transcripts return `summary: null` for all sessions — the auto-summary isn't populated. This means we have to infer work from `lastUserMessage` which is often a context-carry message, not actual intent.

**Fix:** Run `brain_ask` with the transcript IDs to get richer context, or wait for brain to index summaries. Could also try pulling the actual `.jsonl` transcript files directly to read recent turns.

### 2. Campaign-Hub Sessions Are Untracked
The `risingtides-campaign-hub` sessions show `projectName: null` — brain doesn't have this project indexed as active yet (it's in a different root path: `/Users/risingtidesdev/risingtides-campaign-hub/risingtides-campaign-hub`). This is the most-worked project and shows as invisible to brain.

**Fix:** Get brain to index this project path. Add to brain's scan config or manually trigger re-index.

### 3. Email Context Is Shallow
We search recent email but only get snippets. For production error emails (like the Postiz TikTok failure), we should fetch the full thread to get error details.

**Fix:** Add a second pass — for emails from key senders (postiz.com, railway.app, vercel.com, supabase.io), call `get_thread` to pull full body and surface specifics.

### 4. No iMessage Context
The `brain_transcripts_recent` tool covers Claude sessions but not Telegram/iMessage threads where client work is discussed. There's an iMessage MCP available.

**Fix:** Add iMessage read at standup time — search recent conversations for campaign names (Marlowe, Rising Tides, etc.) to capture client-communicated blockers.

### 5. No n8n / Automation Workflow Status
There's no check on automation health — n8n workflows, Railway deployments, Supabase edge functions. A failing automation can be silently broken for days.

**Fix:** Add a step to check Railway/Vercel/Supabase deployment status for active projects.

### 6. Stale Alert Noise
34 "urgent" alerts are for projects 70-273 days dormant — they pollute the standup. These are prototype/abandoned repos masquerading as urgent.

**Fix:** Filter alerts to projects with `status: active` only. The brain `inFlight` list was empty, which is the right signal to use.

## Suggested Standup Structure (Refined)

```
1. LIVE ISSUES (email errors from prod services, past 24h)
2. WHERE I LEFT OFF (last 3 active sessions with actual context)
3. IMMEDIATE ACTIONS (unpushed commits, deploy blockers)
4. TODAY'S FOCUS (ranked by project priority)
5. OPEN CODE TODOS (from active projects only)
6. BACKLOG PULSE (1-liner on stale count, no details)
```

## Data Sources Priority

| Source | Value | Current Usage |
|---|---|---|
| brain_standup | High | Yes |
| brain_transcripts_recent | High | Yes — but limited by null summaries |
| brain_git_dirty | High | Yes |
| brain_projects (active) | High | Yes |
| Gmail (search recent) | Medium-High | Yes — shallow |
| Gmail (get_thread for prod errors) | High | Not yet |
| iMessage | Medium | Not yet |
| brain_open_loops (transcript) | Medium | Yes |
| n8n/Railway/Vercel status | High | Not yet |

## Next Standup Improvements to Implement

- [x] Full thread fetch for emails from: postiz.com, railway.app, vercel.com, supabase.io, sentry.io *(implemented 2026-04-23)*
- [ ] iMessage scan for client names and campaign keywords — **FDA is granted; `get_unread_imessages` works. Real block is upstream: no allowlist file from John, so unread queue is 100% spam.** 5th standup carrying this. Auto-skip until allowlist exists.
- [x] Filter brain alerts to active projects only (skip stale) *(implemented 2026-04-23 — ignore alerts for projects not in brain active list)*
- [x] Pattern detection for repeat production errors *(implemented 2026-04-24 — detects ≥2 same-sender same-error emails in 48h, escalates as PATTERN)*
- [ ] Try `brain_ask` to get richer session summaries
- [ ] Check Vercel/Railway deployment status for content-posting-lab, tidestracker, and risingtides-campaign-hub — still doing this manually by reading `git log` + inferring from session complaints *(8 standups carrying)*
- [ ] Auto-cross-reference git log against active work orders to mark them resolved/superseded automatically
- [x] **Brain MCP health probe** — first line of standup pipeline *(2026-05-06 — `open_loops.refined_text` schema bug from May 1 is fixed, brain returned clean data today; treat all brain calls succeeding as implicit pass, surface explicit banner only on failure)*
- [ ] **Carryover counter as code** — parse last 7 standups, auto-tag 🔁 NTH STANDUP for repeating action items
- [ ] **DoD auto-audit** — parse `## Definition of Done` in each `WO-*.md`, surface `[x]/[total]` and "STALLED" if 0/N for >2 days
- [ ] **Live `git status` re-verification step** — before repeating any "broken/dirty/WIP" claim from a prior standup, re-run `git status -sb && git log --oneline -8` to confirm. Today caught 2 stale carryover claims.
- [ ] **Reframe iMessage in spec** — unread queue is spam; switch to targeted `read_imessages` for named client/creator contacts only

## 2026-05-12 run notes (Tue, brain MCP fully DOWN)

- **5 brain-degraded standups in 17 days.** Today brain returned `Command failed with no output` on all 7 calls — identical to 4/28. The 5/11 "indexer stale" pattern has crossed over into "indexer dead." Promote: standup pipeline must assume brain is optional, not authoritative. Live `git`+`gh`+Gmail bundle is now the load-bearing source, brain is supplementary. Update `10-gather.md` to reflect this — currently it leads with brain.
- **Tier B "gitignore noise" pattern is the new sweet-spot fix.** Today opened 2 PRs (tidestracker #5, campaign-hub #43) both adding `.claude/` to `.gitignore`. Single-file, sub-15-min, no logic change, prevents recurring `?? .claude/worktrees/` lines from polluting every future `git status`. The same class of fix likely exists in 2–3 more active repos. Worth a gather-phase step: "for each active repo, grep .gitignore for `.claude/` — if missing AND `.claude/worktrees/` is present, queue a Tier B PR."
- **WO close-rate is 0%.** WO-01/02/03/05 all at 0/N DoD since opening (16-18 days). WO-04 only moved because the standup itself auto-marked it superseded. The work-order template is not a forcing function — it's a write-only debt log. Either (a) WOs need DoD enforcement (Telegram blast when 0/N for >N days), or (b) the format should be replaced with something inherently action-shaped (e.g. a draft PR with the diff scaffolded so the next step is "approve, don't write").
- **DoD audit bash broke on zsh** — `status` is readonly. Trivial one-line rename to `wo_status`. ~30 sec.
- **PR #12 finally closed today (5/12)** after teeing up the architectural decision via comment on 5/07. 5 days. This proves the Tier C "post a structured comment, then walk away" pattern works as a forcing function — slower than ideal but eventually drives closure. Worth replicating for PR #5 (26d idle now).
- **Daytona-style "external SDK breaking change" emails** are a new class of signal — not an error, not noise, but a calendar-relevant deadline. Worth a `📅 EXTERNAL DEADLINES` section if the data starts repeating.
- **Today's chat-output target hit at 2 PRs / 0 WOs / 8 NEEDS-JOHN.** Per the charter that's a healthy ratio — actions > work orders. But 8 NEEDS-JOHN for the 3rd straight standup is the structural pattern, not a today-anomaly.

### Concrete next-implementation list (delta vs 5/11)
1. **Brain-optional pipeline rewrite** (5th brain-degraded run) — formalize live-`git`+`gh`+Gmail as the default, brain as enrichment.
2. **DoD audit bash fix** — zsh readonly var; 30-sec fix.
3. **Tier B "gitignore noise" gather step** — auto-detect repos that should ignore `.claude/`.
4. **PR-decision cost surfacing** (still missing; 2nd carry).
5. **Deploy-status probe** (11th carry; brain-down today made it acutely load-bearing).
6. **Carryover counter as code** (6th carry).
7. **Drop iMessage from `10-gather.md`** (8th carry; trivial spec edit).

## 2026-05-11 run notes (first standup after a 4-day gap)

- **First M–F-only standup that woke up to a multi-day silence.** Sched runs M–F, so Fri 5/8 → Mon 5/11 is a 3-night gap; the previous standup file is 5/07. The format implicitly assumed yesterday→today continuity. The work-week-resumption mode should be a first-class case: lead with "what changed while you were away" — for every active project, run `git log origin/main --since=$LAST_STANDUP_DATE` and surface as the top section. Today's load-bearing finding (content-posting-lab shipped 15+ prod commits Sat–Sun) only surfaced because I cross-verified live `git`. A "Mon = re-orientation" mode would have surfaced it automatically.
- **Brain indexer staleness is silent and dangerous.** `brain_doctor` reported healthy (7453 embeddings, postgres up, ollama configured). `brain_standup` returned data — but every timestamp was from 5/07. `brain_transcripts_recent(days=2)` returned 0 sessions. Without the live-git cross-check, the standup would have framed today as "all quiet on the western front." Promote to Tier-1 pipeline alarm: **if `brain_transcripts_recent(days=2)` is empty AND `brain_git_dirty` is non-empty AND the most recent commit on any active project per brain is >24h old → SURFACE INDEXER-STALE BANNER before any other section.** Today this would have been the lead.
- **Cross-org PR enumeration caught duplicate work.** Campaign-hub `Risingtides-dev` org has 4 new PRs opened on 2026-05-08 (#15, #18, #19, #20), three of which are duplicates of the same "Wiki — first pass" effort. Looks like an agent over-spawned. Brain doesn't index PRs. Without the explicit per-org `gh pr list` step, those would have been invisible. Confirms 5/07 lesson: per-org enumeration is a permanent step.
- **Inactivity-as-pattern.** PR #5 (25d), PR #12 (4d post-comment), PR #24 (4d mergeable-but-unmerged), Week 1 scaffold (4d uncommitted), rising-tides-course Stripe WIP (27d). These are not 8 issues, they're one pattern: John's PR-decision queue is structurally >5 items and the standup is restating them without forcing closure. Worth a "closure-required" section that surfaces the cost per item (days idle × downstream block). Today done by hand under "TODAY'S FOCUS" with time estimates.
- **Branch sprawl exploded.** Campaign-hub went from ~16 `claude/*` branches (5/07) to 120+ (5/11). 4 days of unsupervised agent activity creates a ~30-branch/day baseline. Branch-sprawl detector is now overdue, not just nice-to-have.
- **The 4-day Anthropic billing thread silence is its own signal.** John replied 5/06 23:59 UTC, demanded itemization, got no human reply for 4 days. Standup should treat "support-thread last-sent-by-user >72h" as escalation-required, separate from "open ticket."
- **The improvement notes file is becoming load-bearing.** This run leaned on the 5/07 entry to know about (a) the `[gone]` upstream tripwire on content-posting-lab, (b) the PR #12 architectural conflict, (c) the iMessage no-allowlist auto-skip, (d) the cross-org `gh` issue, (e) the dev-server orphan rule. Each one saved a re-discovery loop. The file IS the standup's working memory — keep growing it, and consider promoting recurring lessons to `instructions/10-gather.md` so they're not in the prose log.

### Concrete next-implementation list (in priority order)
1. **Indexer-stale Tier-1 alarm** (1-hour fix; today's lead miss).
2. **Weekend-gap / work-week-resumption mode** (2-hour fix; reframes Monday standups).
3. **Deploy-status probe** (10th carrying; today's content-posting-lab firefight is the load-bearing case).
4. **Branch-sprawl detector** (campaign-hub now at 120+ claude/* branches).
5. **PR-decision cost surfacing** (close-the-queue forcing function).
6. **Carryover counter as code** (5th carrying; ~1 hour Python).
7. **DoD auto-audit** (5th carrying; ~30 min bash).
8. **Drop iMessage from `10-gather.md`** (7th carrying; trivial spec edit).

## 2026-05-07 second-run notes (16:50 UTC)

- **Two runs in one day, very different outcomes.** The 13:10 UTC first run produced a clean diagnostic with zero actions taken — exactly the failure mode `00-charter.md` was designed to prevent. The 16:50 UTC second run took 3 actions: killed two orphan dev servers, auto-rebased PR #24 to MERGEABLE, attempted PR #12 rebase and posted a structured human-resolution comment when the conflict turned out to be architectural. **Lesson: the prompt files work; "default toward action" only kicks in if the run frames its job as acting, not reporting.** Add detection for "if today's standup file exists with empty 🤖 ACTIONS TAKEN, the second run's job is to take actions, not append diagnostics."
- **Tier B agents with `isolation: "worktree"` worked exactly as designed.** Two agents spawned in parallel, no conflicts, both finished under 90 seconds. The PR #24 rebase shipped clean; PR #12 self-aborted correctly when the conflict revealed itself as architectural. The "abort and post a structured comment" pathway is real Tier C value — distinct from pure NEEDS JOHN. The standup output spec should make that distinction visible (status column should have a "📝 Tier C — comment posted" flag separate from "⚠️ NEEDS JOHN").
- **PR-search across orgs is broken.** `gh pr list --state open --search "user:Risingtides-dev"` returns `[]` even though that user has open PRs. Had to enumerate per-org (Risingtides-dev, KINGMAKER-SYSTEMS, jakebalik-bit). Spec needs a per-org walk, not a single global search.
- **WO-04 officially marked SUPERSEDED today** with the banner per `20-act.md` Tier A spec. It was functionally dead since 2026-04-24 when WO-05 was opened. The standup format kept re-listing it weekly. This is the kind of housekeeping the routine should do without prompting — and now it does.
- **PR #5 is the perpetual stuckness pattern.** Mergeable docs-only PR with 5 unanswered open questions in its body. By the no-touch list it could be auto-merged; by common sense it shouldn't be merged until the questions are answered. The 30-day-old docs-PR auto-comment idea (post a comment enumerating the open questions, asking John to inline-answer or close) is a real forcing function. File as pipeline TODO.

## 2026-05-07 run notes

- **Live `git status` re-verification caught 2 mischaracterizations from 5/06.** (a) Yesterday filed `rising-tides-course/customer-support` as pure "drift, decide rebase/cherry-pick/abandon" — live diff today shows substantive uncommitted Stripe webhook + D1 schema work mid-flight. The decision is **commit-or-stash first**, *then* address drift. (b) Yesterday filed `content-posting-lab` as `feature/sounds-message-html-links` dirty with `lazy-Rosana/`. Live state today: upstream branch is `[gone]` (deleted on remote). Any naive `git push` would create a new branch from scratch silently. **Lesson:** the verification step from 4/28 has now caught stale claims on 3 separate standups — keep it permanent, never trust prior-day characterization.
- **`gh pr list` cross-check is a permanent step now.** Today it surfaced campaign-hub PR #12 (`fix(scraping): unblock original-sound discovery for tracked creators`, draft, CONFLICTING) which is the technical unblock for the very issue John flagged in last night's session. Brain didn't surface it because brain doesn't index PRs. Without the `gh` step the standup would have missed the most relevant signal in the entire data set.
- **Worktree fragmentation is a new pattern.** Campaign-hub had a 1102-message session overnight that ended with John saying "go check other worktrees buster" — the current branch has zero new commits. This means the work either landed on one of 16+ ephemeral `claude/*` branches or was lost. The standup needs a "branch sprawl" detector: for active projects with N+ unmerged `claude/*` branches and a long session that didn't commit to current, flag as "WORK MAY BE LOST."
- **Long-session-with-no-commit detector.** Two sessions today (1102 msgs and 460 msgs) ended without git activity in their cwd. This is structurally different from "session in progress" — these sessions ENDED. Worth flagging.
- **iMessage at 6 standups of 100% spam.** Time to stop. The pattern isn't "iMessage permission issue" or "spec wrong" — it's **John doesn't get work texts on iMessage.** Client comms are Telegram (unreadable), Slack, email. Drop the data source from the spec; add a one-line "iMessage: not a work-comms channel for John (6 standups confirmed)" to STANDUP_PROMPT.md and stop calling the tool.
- **Anthropic billing thread is a new "live issue" pattern.** A multi-message Gmail thread where John pushed back on an automated answer and is waiting for a human is functionally a LIVE ISSUE — the cost of doing nothing is the rest of the $74 credit. The standup should detect "John sent the last message in a support thread" and surface as live.
- **Two billing alerts from 5/06 (Replicate, Hetzner) didn't repeat today** — either John actioned them or the senders only fire once. Worth confirming via a second pass next standup, not assuming "resolved."
- **Dev-server orphan detection is paying off.** Caught `:3777/:3778` bound to the `hopeful-agnesi-f3dbc3` worktree whose session ended >20h ago. Same problem as 5/06 (different worktree). Standardize the rule: "any dev_server whose owning session ended > 6h ago = orphan."

## 2026-05-06 run notes

- **Brain `open_loops.refined_text` schema bug from May 1 is fixed.** Today's `brain_open_loops` returned clean data with `refinedText: null` populated. Resolution of a 3-standup carryover. Lesson: trivial bugs do get fixed eventually if the standup keeps escalating them — but the standup didn't *cause* the fix, it only kept the cost visible.
- **Open-PR age check is the highest-leverage new improvement.** Today caught PR #5 on campaign-hub at 8 days idle, no reviews, no failing checks, MERGEABLE. The standup format treated it as a backlog item until I dug into it; it should have been a LIVE ISSUE on day 7. New rule proposed: `gh pr list --state open --json updatedAt` for active repos, anything > 7d → LIVE ISSUE, with self-merge prompt if docs-only.
- **iMessage queue is spam-only for the 5th standup.** Time to stop calling `get_unread_imessages` until John provides a contact allowlist. The 13 messages I rendered today were Amazon scams, gambling spam, and a 2025 Coinbase scam — zero signal. Carrying as memory note already; auto-skip in pipeline next.
- **Active-project gating for TODOs would have saved 80% of `brain_open_loops` noise.** Today's 50-row TODO dump was dominated by `viral-course*`, `tui-sonnet`, `video-companion`, `tldraw-agent`, `delayed-streams-modeling` — all stale or third-party. Filter to `brain_projects.status = 'active'` (only 4 today: claude-monorepo, gemma-chat, content-posting-lab, risingtides-campaign-hub) before rendering.
- **+N -M divergence is a stronger "decide now" signal than just "dirty".** `rising-tides-course/customer-support` at +3/-10 for 23 days is the textbook case. Surface explicitly when M > 5 — that's a branch that's drifting from main, not just a WIP.
- **Dev-server orphan detection.** Brain showed 3 dev servers bound to `content-posting-lab` worktrees (ports 8000, 5173, 52199), associated with worktrees from sessions that ended hours ago. These are orphans. Standup should suggest `kill` commands for processes whose owning sessions ended >24h ago.
- **Cron install from prior session is a dangling todo.** "Let's go ahead and merge number eight and then install the Cron" — merge happened, cron status is unknown to me. Standup should auto-cross-reference last-session-final-instruction against current state. Gap.

## 2026-05-01 run notes

- **Two new escalation rungs introduced today.** (a) `rising-tides-course` drift filed as `DEBT-01` and removed from the daily action list — this was recommended Apr 30 and shipped today. (b) The brain `open_loops.refined_text` schema bug, carried 3 standups as a "Not Surfaced" footnote, was promoted to action item #2 because it's a 5-minute fix that's been ignored. **Test:** if both items are still rotting Monday (5/04), the standup format itself is the bottleneck — escalation rungs aren't enough, and we need a forcing function that blocks the standup from rendering until they're addressed.
- **Pattern broke in Postiz emails on Apr 30.** No fresh `nevo@postiz.com` errors yesterday after 11 straight days. Standup didn't fold this into "all good" — explicitly enumerated 3 hypotheses (TikTok recovered / Postiz paused / email noise) and recommended a 15-min dashboard check to disambiguate. **Lesson:** absence of error is not the same as absence of failure. Always treat a sudden silence in a high-frequency error stream as suspicious and investigate, not assume.
- **Day-Ahead CC cross-validation worked.** Today's 5/01 CC email named the Postiz error as #1 priority — same as the standup's #1. Two days running this independent agent has converged on the same top item. That makes the cross-reference signal load-bearing, not just decorative. Worth surfacing more prominently when they agree (or *especially* when they disagree).
- **DoD auto-audit still hand-counted today.** `grep -c '^- \[ \]' WO-05*.md` would have given the 0 / 6 count programmatically. 10-line bash script away from automation. This is the second-cheapest improvement on the entire list — promote.
- **WO-04 still not formally Superseded** after 7+ days of being effectively dead. The standup keeps recommending it. The reason it never happens: it's an action item without an obvious 60-second path. Could the standup itself emit the closure (write `**STATUS: SUPERSEDED BY WO-05 — 2026-05-01**` to the top of the file) when it determines a WO has been functionally invalidated for >3 days? Worth designing.
- **Carryover counter still hand-counted.** 8th standup, 7th standup, 4th standup tags all hand-eyeballed by re-reading prior files. The Apr 28 + Apr 30 notes both flagged this. ETA was estimated at 1 hour of Python — implementing this would close more loops than any other single improvement.
- **Drift counter as a structural-debt trigger worked.** Filing DEBT-01 took the rising-tides-course drift off the daily action list cleanly. If it stays off and john doesn't notice for 5 days, that's a signal the work was never load-bearing. If he asks "what happened to course?" within 48h, the format is healthy. Either outcome is informative.

## 2026-04-30 run notes

- **Brain schema bug surfaced.** `brain_standup` and `brain_open_loops` both fail with `column open_loops.refined_text does not exist`. `brain_doctor`, `brain_git_dirty`, `brain_projects`, `brain_alerts`, `brain_transcripts_recent` are fine. Whoever added `refined_text` shipped the read-side change without the migration. Quick fix: add the column to `open_loops` (probably nullable text), or revert the read.
- **`brain_doctor` reports 0 embeddings** with Ollama configured. Either the embedder hasn't started or `embeddings` is the wrong column to read. Worth a 5-min check — semantic search across transcripts is dead until this is fixed.
- **`brain_transcripts_recent` returned 1 session for the last 2 days.** That can't be right given how much john codes. Transcript ingestion is probably lagging or filtered too aggressively (e.g. only counts sessions >N messages or with specific cwd). Standup loses the "where I left off" narrative when this is empty.
- **Postiz pattern needs an automatic escalation rung.** Day 11 with 26 failures and the same "make a call today" line in every standup. The standup itself isn't moving the needle — recommend adding a hard-stop block at day 7 that says "this is now an outage, the standup will refuse to render any other agenda until WO-05 has at least 1 DoD checkbox ticked." Force the human into the loop.
- **rising-tides-course drift counter is now structural debt.** "10 commits behind" hasn't moved in 48h. After 5 standups, the standup format should escalate from "make a call A/B/C" to "I'm filing this as DEBT-01 and removing it from the daily agenda until you check it back in." Otherwise it dominates every standup forever.
- **Carryover detection is still string-matched eyeball work.** Counted "Nth standup carrying this" by re-reading yesterday's file. Should be code that diffs prior standup action lists against today's git state and tags carryover automatically. Promote this to next-implementation.

---

## Session Log

### 2026-04-23

**What improved vs yesterday:**
- Full thread fetch now implemented for Postiz emails — revealed two TikTok failures (Baker Mansfield + Gavin) with exact error text
- Stale alert noise eliminated — 25+ "urgent" alerts from dormant repos ignored; only 3 truly active projects surfaced
- Work order status tracking added — WO-01 (clipper deploy) appears resolved (PRs #33/#34 merged), flagged in standup
- Platform signal section added — Claude Managed Agents memory beta is directly relevant to the superbrain project

**Still missing:**
- iMessage/Telegram scan: the tidestracker "im so sorry" session ending and the campaign-hub session about Cobrand likely had prior Telegram context we can't see
- Railway/Vercel deploy verification: still doing this manually from git log; should auto-check deployment status
- Session intent inference: still no summaries from brain_transcripts, relying on `lastUserMessage` which is unreliable for long sessions (1,186+ messages)
- Work order resolution tracking: no automated way to know which work orders shipped; doing it by reading git log manually

**Recommended next structural change:**
When two or more Postiz error emails arrive on consecutive days with the same error, the standup should surface this as a "recurring pattern" not just a one-off. Add pattern detection: if the same error from the same sender appears >1 times in 48h, flag as PATTERN rather than ISSUE.

**Bug caught 2026-04-23 (post-standup):**
The "Platform Signal" section incorrectly framed the Claude Managed Agents memory beta as relevant to the superbrain/Claude Code setup. These are separate products — Claude Managed Agents is an API platform (`platform.claude.com`), Claude Code is the local CLI. Future standup: when surfacing Anthropic product emails, explicitly note which surface area the feature applies to (API / Claude Code / Claude.ai) before assessing relevance.

### 2026-04-24

**What improved vs yesterday:**
- **Pattern detection working as intended.** Yesterday's standup flagged 2 Postiz errors as a possible systemic issue. Today, a full 6-day/7-creator sweep confirmed it's a platform-wide break, not a content problem. This changed the recommended action from "re-queue + fix caption" (WO-04) to "diagnose TikTok API raw response and escalate to Postiz support." Pattern detection prevented another day of wasted one-off fixes.
- **Work-order obsolescence detection.** WO-04 (Marlowe-specific) was explicitly marked superseded because the pattern evidence invalidates its premise. Future standups should do this automatically when a WO's scope contradicts new signal.
- **Git verification of session outcomes.** Ran `git log --oneline -8` on the top 3 active projects instead of only reading brain state. Caught tidestracker PR #4 big merge + `ec2bb26` bugfix that brain hadn't yet indexed — richer "shipped since yesterday" narrative.

**Still missing:**
- iMessage scan is blocked by macOS permissions — chat.db returns "authorization denied." This needs Full Disk Access granted to the running Claude Code process (System Settings → Privacy & Security → Full Disk Access → add Claude Code binary). Worth testing once granted.
- Deployment verification is still manual — no Railway/Vercel status check integrated. Two days in a row, "verify production reflects latest merge" has been a top action. This is automatable.
- The Day-Ahead CC email from `smathdaddy+cc@gmail.com` is Google's experimental productivity agent, and its body is truncated when fetched via get_thread (just the footer comes through). Its value is its *priority ranking* (it called out "resolve critical technical failures in production and social media automation" as top-of-mind, which matched our Postiz finding). Worth keeping as a cross-reference signal even without full body access.
- Risingtides-campaign-hub shows `fatal: not a git repository` at its working path. This is a real problem — not just brain indexing noise. Standup should elevate "git state is broken" alerts above normal dirty-tree reports.

**Recommended next structural change:**
Add a **"Not Surfaced" section** to each standup (started today) that transparently lists what data sources failed or were truncated. Helps distinguish "no signal" from "signal missing due to tooling gap" — important when deciding whether to trust the absence of an issue.

**Second recommended structural change:**
The three active projects (content-posting-lab, tidestracker, risingtides-campaign-hub) have been the same for 3+ days. Consider a "Project Pulse" header that tracks days-since-last-commit / open-WO-count per active project, so it's obvious when one stalls. Example: campaign-hub has had a WO open since Apr 22 with zero shipped code — that should surface more prominently than it did today.

### 2026-04-27 (Monday — first standup after weekend)

**What improved vs Friday:**
- **Caught a stale claim from the prior standup.** Friday's standup said `risingtides-campaign-hub` was "fatal: not a git repository" — running `git status` directly today showed an active branch (`feat/link-tracker-to-campaign`) with multiple recent commits and a coordinated cross-stack WIP. Always re-verify "broken state" claims that carry over multiple days; they may have been wrong on first detection.
- **Time-window correction on patterns.** Friday's standup framed the Postiz issue as "6 days, 7 creators." A fresh email sweep showed it's now **9 days, 9+ creators, ~17 confirmed failures** with same-creator repetition (Geoff Gordon ×4 days). Pattern detection should re-compute the *full window length and severity* every day, not just append "another day."
- **WO Definition-of-Done auditing.** WO-05 was opened with a clear Step-1 unblock (capture raw TikTok error from Postiz dashboard). Three days later the DoD has zero checkboxes. The standup elevated this to top of the brief with a "do exactly one thing first" framing — DoD audit needs to be a recurring step.
- **Surfaced a non-engineering opportunity** (Instagram User Research invite, May 11–15) that is calendar-relevant *today* but not technical. Mixing in time-bound non-code items where they're decision-relevant adds value without bloating the engineering signal.
- **Financial signals pruned to one short section** — Day-Ahead CC, Rocket Money digest, and Anthropic invoice were collapsed into a 3-line "Ops/Finance noise" block. Previous standups risked over-weighting these.

**Still missing:**
- iMessage scan: **3rd standup blocked.** This is now a structural gap, not a transient one. Either (a) get Full Disk Access granted, (b) try a non-DB read path (AppleScript over Messages.app), or (c) drop it from the standup spec.
- Brain transcripts returned **0 sessions for the last 3 days** — either John didn't use Claude Code over the weekend (plausible) or brain's session indexer broke. The standup currently can't tell which, so it just notes "data unavailable." A `brain_doctor` or last-index-timestamp check would disambiguate.
- Deployment status (Railway/Vercel/Supabase) is still inferred from git log + email errors. Two days now we've said "verify production" as a top action — this is automatable and it's costing us a recurring carryover item.
- WO-05 has been open 3 days with no progress because the standup keeps re-listing it without an enforcement mechanism. Standup is a *report*, not a *forcing function*. The best the standup can do is restate the cost of inaction loudly — done today, but a structural fix would be a Telegram/email blast when a high-priority WO crosses N days without a DoD check.

**Recommended next structural changes:**
1. **Carryover counter.** When an action item appears on N consecutive standups without resolution, escalate visually (e.g., "🔁 3RD STANDUP CARRYING THIS"). Today's standup did this manually for `rising-tides-course` push — make it automatic.
2. **DoD check.** For each open work order, parse the `## Definition of Done` section and report `[x]/[total]` checked. If `0/N` for >2 days, flag as STALLED.
3. **Re-verify "broken" claims.** Any "X is broken" claim that carries from a prior standup should be re-tested live before being repeated. Today caught one such stale claim about campaign-hub's git state.
4. **Brain index health check.** Add `brain_doctor` (or equivalent) at the top of the standup pipeline; surface "indexer behind" as its own status line so empty-session results aren't confused with "no work happened."
5. **iMessage decision point.** This has been blocked 3 days. Either resolve the permission, switch to AppleScript-based reading, or formally drop it from the standup spec. Indecision is the worst outcome.

### 2026-04-28 (Tuesday)

**What improved vs yesterday:**
- **iMessage tool now reachable** (no longer permission-blocked). However, unread queue is 100% spam (recruiting scams, scam SMS). The conclusion isn't "iMessage signal is high" — it's "client work doesn't flow through unread iMessage; it flows through Telegram (a separate app the standup can't read), Slack threads, and direct Postiz emails." Reframe spec accordingly: iMessage is for *named-contact* checks (e.g., specific clients/creators by phone), not unread-queue scanning.
- **Branch identity verification caught 2+ stale claims.** Yesterday's standup said campaign-hub was on `feat/link-tracker-to-campaign` with WIP. Live state today: it's on `docs/telegram-sound-distribution-prd` with only 1 commit ahead of origin. Yesterday's "main is clean, no pending work" claim about content-posting-lab also wrong — there was a whole active feature branch with two new feats. **Lesson: the standup must `git status -sb && git log --oneline -8` on each active project every morning, not rely on yesterday's notes about branch state.**
- **Pattern severity escalation.** Postiz pattern is now Day 10 with ~20 confirmed failures including the *original* Marlowe campaign failing again yesterday. The standup added an explicit "5th standup carrying this" counter and forced a binary decision: capture-or-escape-hatch. Indecision is itself a decision and needs to be named.
- **Carryover counter applied manually.** Today's brief explicitly tags 🔁 5TH STANDUP / 4TH STANDUP / 3RD STANDUP / 2ND STANDUP for items that have rolled. This is the structural change recommended yesterday — implemented manually today, but should be automated.

**Still missing:**
- **Brain MCP was DOWN today.** `brain_doctor`, `brain_standup`, `brain_alerts`, `brain_open_loops`, `brain_git_dirty`, `brain_transcripts_recent` all returned "Command failed with no output." Entire standup had to be rebuilt from `git`, `gh`, Gmail, and iMessage tools. **This is the structural risk yesterday flagged — brain index health check.** Today proved why it matters: silent failure mode means "brain says nothing" and "no work happened" look identical.
- **DoD auto-audit still manual.** WO-05's 0/N checkboxes was read by hand. Implementing this now would close the loop on yesterday's recommendation #2.
- **Carryover counter still manual.** The 🔁 tags are hand-counted by re-reading old standups. Should be automated by parsing prior `standups/*.md` files for action-item titles and matching against today's set.
- **Deployment status still inferred.** 4th day this is a gap. Today's Postiz pattern is the textbook case — 10 days of "was it the API or our payload?" with no live status check on Postiz's own service health.
- **Day-Ahead CC truncation persists.** Body is still snippet-only; only the title comes through. The cross-validation signal is useful (it independently flagged Postiz as top-of-mind today) but detail is gone.

**Recommended next structural changes:**
1. **Implement carryover counter as code.** Glob `standups/*.md` for the prior 7 days; for each ranked action item in today's brief, count consecutive prior standups containing the same title/keyword stem. Inject 🔁 NTH STANDUP automatically. ETA: 1 hour of Python.
2. **Implement DoD auto-audit.** Glob `standups/work-orders/WO-*.md`, parse `## Definition of Done` section, count `- [ ]` vs `- [x]`. Surface in standup as "WO-05: 0/6 checked, opened 4 days ago, STALLED." ETA: 30 min.
3. **Add `brain_doctor` (or equivalent health probe) at the top of the pipeline.** If brain is unreachable, surface this as the first line of the standup — not a footnote — so John doesn't have to scroll to know whether the brief is partial.
4. **Add a deployment status probe.** For each project listed in active set, hit Railway/Vercel API for the deployed sha, compare to `origin/main` HEAD, and report drift. This kills the recurring "verify production" carryover.
5. **Always re-verify "broken state" claims with a live `git status` before repeating them.** Today caught 2 stale claims from yesterday. Make this an explicit step in the pipeline, not a "remember to do it" instruction.
6. **Reframe iMessage in the spec.** Drop unread-queue scanning (it's spam-only). Add a future hook: "if a known client/creator phone number is flagged, do a targeted `read_imessages` for that contact." This is more like an alerting trigger than a discovery scan.
7. **Auto-detect "indecision day."** When the same #1 action repeats N+ days with no progress signal in git/email, the standup should explicitly name this as a stall pattern, not just re-list. Today did this manually for Postiz ("Picking neither is a third 'no decision' day").
