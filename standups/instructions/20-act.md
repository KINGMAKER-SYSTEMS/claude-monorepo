# 20 — Act

_The action framework. Headless, John-absent. Four tiers of escalating commitment; know which tier each action is and never exceed the ceiling._

## The 4-tier framework

- **Tier A — Safe writes (do them):** write/append the standup file, file or correct work orders, codify docs (like these instruction files), append to `STANDUP_IMPROVEMENT_NOTES.md`. Pure-additive, reversible, no shared/prod state touched.
- **Tier B — Safe git ops (do them, isolated):** rebase a stale standup PR to MERGEABLE, push the standup's own branch, open the standup's own PR. Precedent: 6/02 rebased campaign-hub PR #43 via an isolated agent. Use a spawned sub-agent / worktree isolation so nothing collides.
- **Tier C — Needs greenlight (surface, don't do):** `pnpm install` (mutates dependency state across the monorepo), pushing someone else's uncommitted local edits, anything that changes a repo John is actively working. Classify NEEDS-JOHN with the exact command.
- **Tier D — Hard no-touch (see `30-no-touch.md`):** merging non-standup PRs, rotating keys, billing, prod RLS writes, history rewrites. Never headless.

## Sub-agent spawn rules

- Spawn an isolated agent only for **Tier-B** work that needs a clean working tree (rebases, branch pushes). Give it a single scoped task and its own worktree.
- Do **not** spawn agents to "fix" Tier-C/D items — surface them instead.
- Most runs spawn **zero** agents. That's fine.

## Work-order discipline

- File a WO for any data-exposure / data-loss / security item that's above the ceiling to fix.
- **Re-verify, don't re-file.** If a WO already exists, re-check the underlying alert/advisor state live and update the WO *in place* (note the new state); only file a fresh WO for a genuinely new issue. Don't duplicate.
- "We filed a WO" ≠ "it's handled." Re-verify the underlying state every run.

## The headless write-ceiling (proven by denials)

Can: find, verify, file WOs, Tier-A/B git ops. **Cannot:** merge PRs (denied 5/29 + 6/01), push someone's uncommitted edits, rotate keys, touch billing, write prod RLS. Those are NEEDS-JOHN — classify and move on, don't retry.
