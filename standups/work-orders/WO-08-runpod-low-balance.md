# WO-08 — RunPod Low Balance / Pods Stopped

**Filed:** 2026-06-02 by morning-stand-up scheduled task
**Service:** RunPod (noreply@runpod.io)
**Severity:** CLOSED — volume deleted 2026-06-13. WO retained for ledger.

> **Live re-verify 2026-06-13:** ✅ **CLOSED by deletion.** RunPod email 2026-06-13 13:08 UTC: *"Low Balance - Network Volume Deleted"*. The 3 deletion-warning pings (5/31, 6/07, 6/10 13:33 UTC) ran out — the volume is gone. WO is closed; the residual question is whether John recovers from a grace-period backup or accepts the loss. That is a NEEDS-JOHN call, not an active WO.

> **Live re-verify 2026-06-10 (supplement run):** 🔴 still open. **3rd deletion warning email** received 2026-06-10 13:33 UTC ("Low Balance - Network Volume To Be Deleted"). Prior pings: 5/31 10:29 UTC, 6/07 13:09 UTC. The network volume is on borrowed time — each ping is closer to actual deletion. Decision is still refill-or-accept-loss. Billing = no-touch #4, NEEDS-JOHN.

## Context

On 2026-05-31 at 10:29 UTC, RunPod sent:

> "We noticed that your balance is running low. We have stopped your pods until you are able to reload your balance. Please do so as soon as possible, otherwise your pods will be removed and you will lose any data saved on their associated volumes."

A second email (2026-06-02 00:14 UTC) subject "Stop paying for GPUs that sit idle" suggests switching to RunPod Serverless.

## What You Need to Do

1. Go to https://www.runpod.io/console/user/billing and check current balance.
2. **Before topping up**, decide: are these pods still needed? If the project is done, let them expire and save the cost. If active, reload balance.
3. If topping up: reload balance.
4. If expiring: confirm any needed data is backed up from the associated volumes first.
5. Consider switching idle workloads to RunPod Serverless (scales to zero).

## What NOT to Do

- Do not auto-charge — money action, manual only.

## Definition of Done

- [ ] RunPod balance checked
- [ ] Decision made: top up OR let pods expire
- [ ] If topping up: balance reloaded
- [ ] If expiring: confirm data backed up first
