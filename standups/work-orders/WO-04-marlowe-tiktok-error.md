**STATUS: SUPERSEDED BY WO-05 — 2026-05-07** (functionally invalidated since WO-05 was opened on 2026-04-24; the failure pattern proved this is platform-wide, not Marlowe-specific. Banner added by morning-stand-up scheduled task.)

# Work Order #4 (Priority 4 of 4)
# Marlowe TikTok Post — Diagnose & Re-queue Failed Post

**Date:** 2026-04-22  
**Type:** Live campaign issue — no specific repo directory  
**Tool:** Postiz (self-hosted or cloud — check which instance is in use)  
**Error received:** 2026-04-22 at 09:01 AM ET

---

## Context

An automated email arrived from Postiz this morning:

> **Subject:** Error posting on tiktok for Marlowe  
> **From:** nevo@postiz.com  
> **Body:** "An error occurred while posting on tiktok: Invalid request parameters, please check content format"

"Marlowe" is a campaign or creator account. A scheduled TikTok post failed due to a content format validation error from TikTok's API. The post was not published. It needs to be diagnosed and re-queued.

This is a client-facing failure — if Marlowe is an artist campaign, the post timing may be tied to a release schedule.

---

## What You Need to Do

### Step 1 — Identify the Postiz instance

Determine which Postiz deployment is sending these emails:
- Is Postiz self-hosted on Railway or another server?
- Check `/Users/risingtidesdev/dev` for any Postiz-related project directories
- Check Railway dashboard for a Postiz service
- The email came from `nevo@postiz.com` (Postiz cloud), so this may be a cloud-hosted account at `postiz.com`

Log into the Postiz dashboard (cloud or self-hosted URL).

### Step 2 — Find the failed Marlowe post

In the Postiz dashboard:
1. Navigate to the "Posts" or "Queue" section
2. Filter by "Failed" status
3. Find the Marlowe post that failed today (April 22, 2026)
4. Read the full error details — the email snippet is generic, the dashboard often shows the actual TikTok API error code

### Step 3 — Diagnose the format error

TikTok's "Invalid request parameters, please check content format" typically means one of:

| Issue | Check |
|---|---|
| Video aspect ratio | TikTok requires 9:16 vertical (or specific ratios) |
| Video duration | Min 3s, max varies by account type (10min for some) |
| File size | Max 4GB |
| Caption length | Max 2,200 characters |
| Hashtag count | TikTok limits (typically 30 max) |
| Cover image | Must be within video duration |
| Music/sound | Copyrighted audio can block posting |
| Account permissions | Creator account posting limits |

Look at the specific post content — what video was it? What caption/hashtags? What account was it posting to?

### Step 4 — Fix the content and re-queue

Based on diagnosis:

**If it's a format issue (aspect ratio, duration, size):**
- Download the original video from Postiz
- Re-encode/reformat as needed (use ffmpeg if available)
- Re-upload to Postiz and reschedule

**If it's a caption/hashtag issue:**
- Edit the post directly in Postiz
- Shorten the caption or reduce hashtags
- Re-queue for posting

**If it's a permissions/auth issue:**
- Check if the TikTok account token has expired in Postiz
- Re-authenticate the Marlowe TikTok account in Postiz settings
- Re-queue the post

**If it's a timing-critical post (release day):**
- Flag the urgency — if the post was tied to a specific release moment, check with john about whether to re-queue ASAP or reschedule

### Step 5 — Verify re-queue and note the root cause

After re-queuing:
- Confirm the post shows as "Scheduled" (not Failed) in Postiz
- Note what the actual root cause was so it can be prevented in future

If the issue is systemic (e.g., the TikTok account credentials expired, or a content template is consistently generating invalid formats), note it clearly — this likely affects other campaigns too.

---

## What NOT to Do

- Do not delete the failed post record without saving the content first
- Do not re-queue without actually fixing the underlying format issue — it will just fail again
- Do not assume the error is a one-off if it's a credential expiry — check all connected TikTok accounts in Postiz

---

## Definition of Done

- [ ] Postiz dashboard accessed, failed Marlowe post located
- [ ] Root cause of "Invalid request parameters" identified
- [ ] Content fixed (reformatted, caption edited, or credentials refreshed)
- [ ] Post successfully re-queued in Postiz
- [ ] Post goes live without error (confirm after scheduled time passes)
- [ ] Root cause documented (note it here or in a campaign log)
