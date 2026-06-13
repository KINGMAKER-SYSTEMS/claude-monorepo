# WO-09 — Supabase `tracker-auth` Public Tables / RLS Disabled

**Filed:** 2026-06-03 by morning-stand-up scheduled task
**Service:** Supabase — project `tracker-auth` (`imxflhdsfxkfmvsufwvr`)
**Severity:** HIGH → **MEDIUM-HIGH (downgraded 2026-06-05 after live advisor pull, see correction)**

> ### Live re-verify — 2026-06-13 (live `get_advisors` pull)
> Same 3 ERROR lints, unchanged. `policy_exists_rls_disabled` + `rls_disabled_in_public` + `sensitive_columns_exposed` (column `token`). No policy or RLS change since 6/05. Fix is still the same 1-line `ALTER TABLE public.campaign_invites ENABLE ROW LEVEL SECURITY;` + smoke-test. 11 days open. Tier-D, NEEDS-JOHN.

> ### ⚠️ Correction — 2026-06-05 (live `get_advisors` pull)
> The advisor today returns **three** ERROR-level security lints, and they are all on **one specific table: `public.campaign_invites`** — not the auth/user tables. The lints are:
> 1. `policy_exists_rls_disabled` — `campaign_invites` has 4 policies ("Allow anon to create initial invites", "Allow authenticated users to create invites", "Allow marking invites as used", "Allow viewing valid invites") but **RLS is not enabled**, so the policies do nothing.
> 2. `rls_disabled_in_public` — same table, public, RLS off.
> 3. `sensitive_columns_exposed` — the one sensitive column flagged is **`token`** (an invite token), exposed via the API without RLS.
>
> **Net:** This is an **invite-token table**, NOT raw user credentials/PII as the original 6/03 framing assumed. Real risk = someone can enumerate/forge/replay campaign invite tokens (and create or mark-used invites) against the public API. That's a genuine integrity/abuse hole worth fixing, but it is **lower severity than "live auth-DB PII exposure."** Severity downgraded accordingly. The fix is the same shape (enable RLS — the policies already exist, so this is likely a one-liner `ALTER TABLE public.campaign_invites ENABLE ROW LEVEL SECURITY;` + smoke-test).

## Context

On 2026-05-31, Supabase's security advisor flagged two **critical** issues on project `tracker-auth`, re-sent as an email on 2026-06-02 15:48 UTC and surfaced again in today's `+cc` brief:

1. **`rls_disabled_in_public`** — "Table publicly accessible. Anyone with your project URL can read, edit, and delete all data in this table because Row-Level Security is not enabled."
2. **`sensitive_columns_exposed`** — "A table with columns that likely contain sensitive data (like passwords or personal identifiers) is accessible through the API without any access restrictions."

This is a **production data-exposure** issue, distinct from the WO-07 ocean-surface key leak. `tracker-auth` is the auth backend for the tracker product, so the exposed columns are plausibly real user credentials/PII.

Advisor dashboard: https://supabase.com/dashboard/project/imxflhdsfxkfmvsufwvr/advisors/security

## What You Need to Do

1. **Open the security advisor** for `tracker-auth` and list every table flagged `rls_disabled_in_public`.
2. **Enable RLS** on each flagged table: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
3. **Write explicit policies** — enabling RLS with no policy denies all access (which may break the app). Add policies scoped to the real access pattern (authenticated user owns row, service role full access, etc.).
4. **For `sensitive_columns_exposed`** — confirm which columns are sensitive. If they should never be API-readable, move them behind a view, a security-definer function, or revoke column-level `SELECT` from `anon`/`authenticated`.
5. **Re-run the advisor** to confirm both criticals clear.
6. **Smoke-test the tracker app** after enabling RLS — the #1 failure mode is locking out the app's own legitimate queries.

## What NOT to Do

- Do NOT enable RLS on a live table without a policy and walk away — that hard-denies the app and is its own outage.
- Do NOT assume the exposure is harmless — `tracker-auth` is an auth DB; treat exposed columns as compromised until proven otherwise.

## Definition of Done

- [ ] Every flagged table has RLS enabled
- [ ] Each has at least one policy matching real access needs
- [ ] `sensitive_columns_exposed` resolved (RLS + column-level grants or a view)
- [ ] Supabase advisor re-run shows 0 critical issues
- [ ] Tracker app smoke-tested — legitimate reads/writes still work

## Business Impact

Anyone with the project URL can currently read/edit/delete the `tracker-auth` data, including columns that look like credentials or PII. This is an open door to the tracker product's user data.
