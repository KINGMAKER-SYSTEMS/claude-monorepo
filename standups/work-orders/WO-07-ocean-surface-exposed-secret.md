# WO-07 — Exposed Google API Key in `ocean-surface`

**Filed:** 2026-06-02 by morning-stand-up scheduled task
**Repo:** `Risingtides-dev/ocean-surface`
**Severity:** HIGH — GitHub secret scanning flagged a valid secret readable by anyone with repo access

> **Live re-verify 2026-06-13:** 🔴 alert #1 **STILL OPEN** (14 days). `state: open`, `publicly_leaked: true`, `resolution: null`. Key string `AIzaSyCmUHR3JD9AZfw9DiRvvSSZsRitdGuunPs` confirmed live in `crates/ocean-surface-proxy/src/main.rs:43` on `main` at HEAD (commit `e3d8634`). Detector reports `start_line: 42` but in-tree it's line 43 — likely 1-line indexing diff from the indexed blob, key text matches exactly. 30 ocean PRs merged this window, none of them touched this secret. Still NEEDS-JOHN.

> **Live re-verify 2026-06-08:** 🔴 alert #1 **STILL OPEN** (8 days). `publicly_leaked: true`. The repo's 6/05 `feat/voice-agent-first-class` branch merged and is gone; the key was **carried forward into `main`** and is live in the working tree at `crates/ocean-surface-proxy/src/main.rs:43` as `const DEFAULT_MAPS_KEY`. `main` has 2 unpushed commits — **strip + rotate before pushing.** Still NEEDS-JOHN (rotate = no-touch #3, history strip = no-touch #6).

## Context

On 2026-05-31 at 04:33 UTC, GitHub security scanning sent an alert:

> **Google API Key** detected in `crates/ocean-surface-proxy/src/main.rs#L42` · commit `6f117560`
> "Anyone with read access can view exposed secrets."

The key is embedded in Rust source code, not an env file — committed to git history.

## What You Need to Do

1. **Rotate the exposed Google API key immediately** — go to Google Cloud Console, find the key, revoke it, generate a new one.
2. **Audit the new key scope** — ensure it's scoped to only the services it actually needs.
3. **Remove the key from the source file** — replace the hardcoded value with an environment variable read (e.g., `std::env::var("GOOGLE_API_KEY")`).
4. **Add a secrets pattern** — never hardcode API keys in Rust source; use env vars + a gitignored env file, or a secrets manager.
5. **Check git history** — consider whether a `git filter-repo` or BFG clean is needed to remove the key from history if the repo is public or could become public.
6. **Close the GitHub secret scanning alert** at `https://github.com/Risingtides-dev/ocean-surface/security/secret-scanning/1`.

## What NOT to Do

- Do NOT just delete the line and push — the key is still in git history.
- Do NOT rotate the key without also removing it from the code.

## Definition of Done

- [ ] Google API key rotated in Google Cloud Console
- [ ] Hardcoded key removed from `crates/ocean-surface-proxy/src/main.rs#L42`
- [ ] Key replaced with env var read
- [ ] GitHub secret scanning alert resolved/closed
- [ ] Git history cleaned if repo is or may become public

## Business Impact

Anyone with read access to the repo can use the exposed Google API key, potentially generating charges or consuming quotas.
