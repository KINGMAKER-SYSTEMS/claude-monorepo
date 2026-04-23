---
name: triage-inbox
description: List, review, and triage pending feature requests from the shared dev inbox. Convert each into a real GitHub issue in the correct repository, then mark the inbox item resolved. Use when the user asks to triage the inbox, process feature requests, or clear the queue.
---

# Triage Inbox

Operator-side companion to `dev-feature-request`. Pulls pending items out of the shared inbox and helps turn each one into a real GitHub issue.

## Configuration

Required env vars:

- `DEV_INBOX_URL` — base URL of the inbox Worker
- `DEV_INBOX_ADMIN_TOKEN` — admin token (distinct from the submit token coworkers have)

If either is missing, tell the user and stop.

## Flow

### 1. List pending items

```bash
curl -sS "$DEV_INBOX_URL/list?status=pending" \
  -H "x-admin-token: $DEV_INBOX_ADMIN_TOKEN"
```

Response: `{ "items": [ {id, title, body, suggested_repo, submitter, urgency, created_at, ...}, ... ] }`.

Show the user a compact summary (id, urgency, submitter, title, suggested_repo) and ask where to start. Default to oldest-first.

### 2. For each item

Show the full item (title, body, submitter, suggested_repo, urgency). Ask which repository to file the issue in — default to `suggested_repo` if set and valid.

Create the issue using whichever GitHub tool is available in this session (GitHub MCP tools preferred; `gh` CLI if available). The issue:

- Title: copy from the inbox item (optionally tighten wording).
- Body: copy the inbox body, then append a trailer on its own line:
  ```
  ---
  Submitted by <submitter or "anonymous"> via dev inbox (id: <inbox_id>)
  ```
- Labels: apply whatever the repo uses (e.g. `bug`, `enhancement`). Ask if unclear.

### 3. Mark resolved

Once the issue exists, record its URL against the inbox item:

```bash
curl -sS -X POST "$DEV_INBOX_URL/resolve/<id>" \
  -H "x-admin-token: $DEV_INBOX_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"issue_url": "<new_issue_url>"}'
```

### 4. Repeat or stop

Move to the next pending item. When the queue is empty or the user says stop, summarize what was triaged (count, which repos received issues).

## Managing the repo list

Coworkers' agents see the list of available repos via `/instructions`. Keep it current:

```bash
# view
curl -sS "$DEV_INBOX_URL/admin/repos" -H "x-admin-token: $DEV_INBOX_ADMIN_TOKEN"

# replace (PUT is a full replace, not a merge)
curl -sS -X PUT "$DEV_INBOX_URL/admin/repos" \
  -H "x-admin-token: $DEV_INBOX_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"repos": [
        {"name": "org/repo-a", "description": "…"},
        {"name": "org/repo-b", "description": "…"}
      ]}'
```

## Deleting spam

If an inbox item is clearly spam or bogus, delete it instead of resolving:

```bash
curl -sS -X DELETE "$DEV_INBOX_URL/item/<id>" \
  -H "x-admin-token: $DEV_INBOX_ADMIN_TOKEN"
```
