# WO-06 — Railway `arch-linux` flaky build (Playwright CDN download)

**Filed:** 2026-05-29 by morning-stand-up scheduled task
**Repo:** `Risingtides-dev/arch-linux-cloud` (Railway project `rising-tides-agents`, service `arch-linux`)
**Severity:** Low (self-healing) — but generates 3–5 false-alarm "build failed" emails per deploy and has triggered a P1 in 3 prior standups (5/19, 5/20, 5/22).

## Context

The `arch-linux` service emits a burst of "Build failed for rising-tides-agents" emails on nearly every deploy. Live verification on 2026-05-29 (`railway deployment list`) shows the real pattern:

```
ae61dc08 | SUCCESS | 2026-05-29 11:25:22   ← 4th attempt succeeded
5a32a1a0 | FAILED  | 2026-05-29 11:25:00
5d4707a6 | FAILED  | 2026-05-29 11:24:14
ecd37d8d | FAILED  | 2026-05-29 11:22:23
```

Same shape on 5/19 (5+ FAILED then SUCCESS) and 5/21. **The service is not down** — `railway logs` confirms the running container (Caddy on :8080, ttyd, XFCE/noVNC) is healthy. Railway auto-retries the build and a later attempt succeeds.

**Root cause (from the successful build log):** the Docker build step
`RUN playwright install --with-deps chromium firefox` downloads ~100+ MiB browser bundles from `cdn.playwright.dev` inside the build. When that CDN download stalls or the build hits a transient resource ceiling, the build fails; Railway retries and it eventually goes through. This is network/timing flakiness in the build, not a code error.

## What You Need to Do

Make the Playwright browser install resilient so the build stops flaking. Options, cheapest first:

1. **Add a retry wrapper** around the playwright install in the Dockerfile, e.g.
   `RUN for i in 1 2 3; do playwright install --with-deps chromium firefox && break || sleep 5; done`
2. **Split + cache the download layer** — `playwright install chromium firefox` (browsers) as its own layer above `--with-deps` (apt) so Docker layer caching skips re-downloading on rebuilds.
3. **Pin the Playwright version** so the browser build revision is stable and cacheable across deploys.
4. If the desktop/browser stack isn't actually needed for this service's purpose, consider `DESKTOP_ENABLED=0` and dropping the firefox download entirely.

Verify by triggering a redeploy and confirming a single SUCCESS with no intervening FAILED.

## What NOT to Do

- Do **not** disable the service or delete the Railway project — it's healthy and in use.
- Do **not** modify Railway env vars / spend settings (no-touch).
- Do **not** treat the "build failed" emails as an outage — they are retry noise.

## Definition of Done

- [ ] Dockerfile playwright-install step made retry-safe or layer-cached (PR opened against `arch-linux-cloud`)
- [ ] A fresh deploy produces SUCCESS on the first attempt (no FAILED siblings) — confirm via `railway deployment list`
- [ ] No "Build failed for rising-tides-agents" email on the next deploy
- [ ] WO closed, standup carryover for "Railway arch-linux build failure" cleared

## Business Impact

Low direct impact (service self-heals), but each flaky deploy floods the inbox with false-alarm build-failure emails that have repeatedly masked or competed with real signals in the morning standup (the 5/19 standup nearly missed other issues under 10 sync-upstream + Railway emails). Fixing this removes a recurring noise source and a recurring false-P1.
