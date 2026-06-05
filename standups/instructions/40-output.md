# 40 — Output

_How to write the standup file, structure it, and ship the PR._

## File

- Path: `standups/YYYY-MM-DD.md`, one file per day.
- **Supplement convention:** if today's file already exists (a run already happened), **append** a `## 🔄 SUPPLEMENT — Second run (…UTC)` section with deltas only. Never overwrite the first run.
- **Local-first.** The file is the deliverable; the PR is a side-effect. Write it to the working tree first.

## Structure (adapt to the day — these are the load-bearing sections)

- **Header line:** date, generator, ~UTC time, DEGRADED flag (+ brain-down day count), one-line "what kind of day this is."
- **Good news first** when carryovers clear or big work ships — lead with it.
- **Security** (re-verified live, with receipts) — usually the lede.
- **DECIDE NOW** — carrying items where indecision is the decision, with the forced choice and a carry-count.
- **Live issues (48h)** — must-act-today, with source + status.
- **Shipped/active over the gap** — what moved.
- **Active project state table** — per-repo branch/dirty/ahead-behind/last-commit.
- **Today's focus (ranked)** — NEEDS-JOHN, can't-auto-act.
- **Actions taken (this run)** — ✅ what you did, ⛔ what you deliberately did NOT do (and why).
- **Carryovers table** — item / # of standups / status. Re-verified, not assumed.
- **Data source status** — which pulls worked, which were degraded.
- **Pipeline TODOs** — appended to `STANDUP_IMPROVEMENT_NOTES.md`.
- **Footer line** mirroring the header with a one-line outcome.

## Work orders

- Live under `standups/work-orders/WO-NN-slug.md`.
- Re-verify and edit in place; only file new ones for genuinely new issues. Keep a ledger in `STANDUP_IMPROVEMENT_NOTES.md`.

## Commit / PR rules

- Branch: `auto/standup-YYYY-MM-DD` (or `…-supplement` for a second run on its own branch).
- Commit message: `standup: YYYY-MM-DD` (or `standup: YYYY-MM-DD supplement`). Conventional, scoped to `standups/**`.
- Open the PR; **do not auto-merge it** (no-touch #2).
- The standup files don't always reach `main` locally (each run spawns its own worktree). That's a known pipeline gap — the PR flow is the path of record. Don't block on it.

## End-of-run chat output (max 3 lines)

`PRs opened: … / WOs filed: … / Still needs John: …`
