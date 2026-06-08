# 00 — Charter

_Codified 2026-06-05 (supplement run) from the de-facto process living in past standups + `STANDUP_IMPROVEMENT_NOTES.md`. Closes the 4-standup "phantom instruction files" carryover. The scheduled-task prompt references these files as the source of truth; this set makes them real._

## What this is

John's M–F morning standup. A scheduled task runs it headless (John is not present). The job: pull live state across his stack, surface what actually changed and what needs his hands, file/verify work orders for anything dangerous, and write a dated standup file. The PR is a side-effect — the **file** is the deliverable.

## What success looks like

1. **Bias to action within the write-ceiling.** Find, verify, file work orders, do Tier-A/Tier-B safe ops (see `20-act.md`). Don't ask permission you can't get — John isn't here. Make the reasonable call and note it.
2. **Every carryover is re-verified live before it's re-promoted.** A carryover is a *hypothesis*, not a fact. Run the live command (`gh api`, `git rev-list`, `get_advisors`, `rev-parse`) before writing it again. Stale carryovers rot into permanent false-alarm noise — this has burned us (content-posting-lab "loss risk" and campaign-hub "111 ahead" were both false the moment checked).
3. **Security is the lede.** Open secret-scanning alerts + Supabase advisor state are a first-class gather step, not an email side-effect.
4. **Report faithfully.** If something is still open, say so with the receipt. If a fix was skipped because it's above the ceiling, classify it NEEDS-JOHN and move on. No fake "handled."
5. **3-line chat summary at the end:** PRs opened / WOs filed / things still needing John.

## Degraded-mode is normal

Brain MCP + CLI have been down since ~4/28. **Do not block on it.** Compose from live `gh` + `git` + Linear + Gmail + Supabase + iMessage. Note it as DEGRADED in the header and keep going.

## Tone

Terse, receipts-first, no hedging. This is John's morning glance — lead with what changed and what's on fire, bury the FYIs.
