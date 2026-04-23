# @brain/inbox-worker

Cloudflare Worker that backs the `dev-feature-request` skill. Coworkers'
Claude Code agents ping `/instructions` to get live submission instructions
plus the current list of projects, then `POST /submit` a request into a
KV-backed inbox. A maintainer uses the `triage-inbox` skill (admin token) to
list, review, and convert each submission into a real GitHub issue in the
correct repo.

## Endpoints

Coworker-facing (auth: `x-inbox-token` header = `SUBMIT_TOKEN`):

- `GET /health` — no auth
- `GET /instructions` — returns `{ instructions, repos, submit_url, urgency_options }`
- `POST /submit` — body: `{ title, body, suggested_repo?, submitter?, urgency? }` → `{ id, status }`

Admin (auth: `x-admin-token` header = `ADMIN_TOKEN`):

- `GET /list?status=pending|resolved`
- `GET /item/:id`
- `POST /resolve/:id` — body: `{ issue_url }`
- `DELETE /item/:id`
- `GET /admin/repos` — current repo list
- `PUT /admin/repos` — body: `{ repos: [{ name, description? }] }` (full replace)

## First-time setup

```bash
pnpm install

# Create the KV namespace for this worker
npx wrangler kv namespace create INBOX
# → paste the returned id into wrangler.toml (replace REPLACE_WITH_KV_ID)

# Set the two secrets
npx wrangler secret put SUBMIT_TOKEN   # shared with coworkers
npx wrangler secret put ADMIN_TOKEN    # yours only

# Deploy
pnpm deploy
```

Note the deployed URL (e.g. `https://dev-feature-request-inbox.<subdomain>.workers.dev`).

## Seed the repo list

```bash
curl -sS -X PUT "$DEV_INBOX_URL/admin/repos" \
  -H "x-admin-token: $DEV_INBOX_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"repos": [
        {"name": "kingmaker-systems/claude-monorepo", "description": "Superbrain + dev tools"}
      ]}'
```

Update any time — the next `/instructions` call returns the new list.

## Sharing the skill with a coworker

1. Send them `skills/dev-feature-request/SKILL.md` from this repo.
2. Tell them to save it to `~/.claude/skills/dev-feature-request/SKILL.md`.
3. Tell them to set two env vars in their shell profile:
   ```bash
   export DEV_INBOX_URL="https://dev-feature-request-inbox.<subdomain>.workers.dev"
   export DEV_INBOX_TOKEN="<the SUBMIT_TOKEN you set above>"
   ```

That's it. In Claude Code they can now say things like "I want to file a bug
about X" and the skill will collect details, show them the current project
list, and submit.

## Local dev

```bash
pnpm dev   # wrangler dev — local preview with hot reload
```

Local dev uses an in-memory KV namespace, so submitted items don't persist
between restarts.
