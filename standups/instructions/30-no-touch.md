# 30 — No-Touch

_Hard list. Never auto-act on these headless, regardless of how safe they look. Each is here because doing it autonomously is either irreversible, touches prod/shared state, or has been explicitly denied._

## Never headless

1. **Merging any non-standup PR.** Other people's / agents' code PRs are John's call.
2. **Auto-merging the standup's own docs PRs.** DENIED 5/29 and 6/01; hardened since. Log them as NEEDS-JOHN; do not re-attempt until a scoped auto-merge rule is explicitly granted.
3. **Rotating, revoking, or editing API keys / secrets.** File a WO (see WO-07). Surfacing ≠ fixing.
4. **Anything touching billing / balances / money.** RunPod top-ups, paid-API spend in a loop, IPO/financial actions. Surface only.
5. **Writing or enabling prod RLS policies / running prod migrations.** File a WO (see WO-09). Enabling RLS with no/wrong policy is its own outage.
6. **Git history rewrites** (`filter-repo`, `rebase` to drop committed content, force-push to shared branches). Includes redacting committed PII — surface it, let John do the rewrite.
7. **`pnpm install` / dependency-state mutation across the monorepo.** Tier-C — surface as a 2-min NEEDS-JOHN even though it's the brain fix.
8. **Pushing someone's uncommitted local working-tree edits.** Not yours to commit.

## PII / privacy hard rule

**Scrub PII from iMessage-sourced lines before writing — always.** iMessage exposes real phone numbers and contact handles. Never copy a raw phone number, email handle, or third-party contact detail into a committed standup file. A phone number once leaked into PR #17 (6/03) and required a history rewrite to remove. Describe the *signal* ("a heads-up about a local outage") without the identifier. Redact at write time, not after.

## When in doubt

Producing a report (NEEDS-JOHN line with the exact action) is always the correct fallback. The standup's value is that nothing dangerous rots silently — not that it fixes everything.
