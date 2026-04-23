---
name: dev-feature-request
description: Submit a dev feature request or bug report to the shared team inbox. Use whenever the user wants to report a bug, request a feature, or flag an issue with any internal project, tool, or service. A maintainer triages each submission into a real GitHub issue in the correct repository.
---

# Dev — Feature Request

Use this skill whenever the user wants to file a feature request, bug report, or general issue for any internal dev project. The submission goes into a shared inbox; a maintainer triages it and opens the real GitHub issue in the correct repo.

The skill is intentionally thin: the inbox returns live instructions and the current list of available projects, so you always work from the latest version without needing an updated skill file.

## Configuration

The inbox endpoint and shared token must be set in these environment variables (set once per machine by whoever shared this skill with you):

- `DEV_INBOX_URL` — base URL of the inbox (e.g. `https://dev-feature-request-inbox.example.workers.dev`)
- `DEV_INBOX_TOKEN` — shared submit token

If either is missing, tell the user the skill isn't configured and stop — do not try to guess values.

## Step 1 — Fetch live instructions and repo list

Always start here, even if you think you remember the flow:

```bash
curl -sS "$DEV_INBOX_URL/instructions" -H "x-inbox-token: $DEV_INBOX_TOKEN"
```

The response is JSON shaped like:

```json
{
  "instructions": "…detailed instructions you must follow…",
  "repos": [{"name": "org/repo", "description": "…"}],
  "submit_url": "https://…/submit",
  "urgency_options": ["low", "normal", "high"]
}
```

## Step 2 — Follow the returned instructions

Treat the `instructions` string as authoritative — it may be updated server-side over time. It will tell you what fields to collect.

Use the `repos` list to help the user pick `suggested_repo`: show them the names (and descriptions if present) and ask which project the request relates to. If they genuinely don't know, submit with `suggested_repo` left null; the maintainer will route it.

## Step 3 — Submit

POST to the `submit_url` from step 1, reusing the same token:

```bash
curl -sS -X POST "$SUBMIT_URL" \
  -H "content-type: application/json" \
  -H "x-inbox-token: $DEV_INBOX_TOKEN" \
  -d @- <<'JSON'
{
  "title": "…",
  "body": "…",
  "suggested_repo": "org/repo",
  "submitter": "…",
  "urgency": "normal"
}
JSON
```

Use a heredoc so the body can safely contain newlines and quotes. Response is `{"id": "...", "status": "pending"}`.

## Step 4 — Confirm

Tell the user the submission id and a one-line summary. Don't echo the whole body back.

## Don't

- Don't put secrets, credentials, tokens, or customer data in the body. If the user includes any, ask them to redact before you submit.
- Don't fabricate a repo name that's not in the returned list — leave `suggested_repo` null instead.
- Don't use this skill for personal TODOs or notes.
