export interface Env {
  INBOX: KVNamespace;
  SUBMIT_TOKEN: string;
  ADMIN_TOKEN: string;
}

type Status = "pending" | "resolved";
type Urgency = "low" | "normal" | "high";

interface InboxItem {
  id: string;
  title: string;
  body: string;
  suggested_repo: string | null;
  submitter: string | null;
  urgency: Urgency;
  created_at: string;
  status: Status;
  resolution: { issue_url: string; resolved_at: string } | null;
}

interface Repo {
  name: string;
  description?: string;
}

const REPOS_KEY = "meta:repos";
const ITEM_PREFIX = "req:";
const URGENCIES: readonly Urgency[] = ["low", "normal", "high"];

const AGENT_INSTRUCTIONS = `You are helping the user file a feature request or bug report for an internal dev project. The request will be queued in a shared inbox, then a maintainer triages it into a real GitHub issue in the correct repository.

Collect the following before submitting:

- title: one-sentence summary of the request.
- body: details. For bugs include reproduction steps, expected vs actual behavior, and environment. For features include the motivation and a rough description of the desired behavior.
- suggested_repo: which project this is about. Show the user the repos list (from this response) — names and descriptions — and ask which one fits. If they don't know, leave it null; the maintainer will route it.
- urgency: one of "low", "normal", "high". Default to "normal" unless the user clearly indicates otherwise.
- submitter: the user's name or handle. Ask once per session if not already known.

Rules:

- Ask at most one or two clarifying questions. A title plus a couple of sentences of body is enough to submit — don't interrogate the user.
- Never include secrets, credentials, customer data, or access tokens in the body. If the user pastes any, ask them to redact first.
- Submit via POST to the submit_url with header "x-inbox-token: <the same token you used to fetch these instructions>" and a JSON body with the fields above.
- After a successful submission, confirm back to the user with the returned id and a one-line summary. Do not echo the full body back.`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unauthorized(): Response {
  return json({ error: "unauthorized" }, 401);
}

function newId(): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${time}-${suffix}`;
}

async function readRepos(env: Env): Promise<Repo[]> {
  const raw = await env.INBOX.get(REPOS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is Repo =>
        typeof r === "object" && r !== null && typeof (r as Repo).name === "string",
    );
  } catch {
    return [];
  }
}

function parseUrgency(v: unknown): Urgency {
  return URGENCIES.includes(v as Urgency) ? (v as Urgency) : "normal";
}

function trimStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    const submitAuth = req.headers.get("x-inbox-token") === env.SUBMIT_TOKEN;
    const adminAuth = req.headers.get("x-admin-token") === env.ADMIN_TOKEN;

    if (method === "GET" && pathname === "/health") {
      return json({ ok: true });
    }

    if (method === "GET" && pathname === "/instructions") {
      if (!submitAuth) return unauthorized();
      const repos = await readRepos(env);
      const submitUrl = `${url.origin}/submit`;
      return json({
        instructions: AGENT_INSTRUCTIONS,
        repos,
        submit_url: submitUrl,
        urgency_options: URGENCIES,
      });
    }

    if (method === "POST" && pathname === "/submit") {
      if (!submitAuth) return unauthorized();
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return json({ error: "invalid json" }, 400);

      const title = trimStr(body.title, 300);
      const text = trimStr(body.body, 20_000);
      if (!title || !text) {
        return json({ error: "title and body are required" }, 400);
      }

      const item: InboxItem = {
        id: newId(),
        title,
        body: text,
        suggested_repo: trimStr(body.suggested_repo, 200),
        submitter: trimStr(body.submitter, 200),
        urgency: parseUrgency(body.urgency),
        created_at: new Date().toISOString(),
        status: "pending",
        resolution: null,
      };
      await env.INBOX.put(`${ITEM_PREFIX}${item.id}`, JSON.stringify(item));
      return json({ id: item.id, status: item.status }, 201);
    }

    // Everything below requires admin auth.
    if (method === "GET" && pathname === "/list") {
      if (!adminAuth) return unauthorized();
      const statusFilter = url.searchParams.get("status");
      const list = await env.INBOX.list({ prefix: ITEM_PREFIX });
      const items: InboxItem[] = [];
      for (const k of list.keys) {
        const v = await env.INBOX.get(k.name);
        if (!v) continue;
        const parsed = JSON.parse(v) as InboxItem;
        if (!statusFilter || parsed.status === statusFilter) items.push(parsed);
      }
      items.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return json({ items });
    }

    const itemMatch = pathname.match(/^\/item\/([A-Za-z0-9_-]+)$/);
    if (itemMatch) {
      if (!adminAuth) return unauthorized();
      const id = itemMatch[1]!;
      const key = `${ITEM_PREFIX}${id}`;
      if (method === "GET") {
        const v = await env.INBOX.get(key);
        if (!v) return json({ error: "not found" }, 404);
        return json(JSON.parse(v));
      }
      if (method === "DELETE") {
        await env.INBOX.delete(key);
        return json({ ok: true });
      }
    }

    const resolveMatch = pathname.match(/^\/resolve\/([A-Za-z0-9_-]+)$/);
    if (method === "POST" && resolveMatch) {
      if (!adminAuth) return unauthorized();
      const id = resolveMatch[1]!;
      const key = `${ITEM_PREFIX}${id}`;
      const v = await env.INBOX.get(key);
      if (!v) return json({ error: "not found" }, 404);
      const item = JSON.parse(v) as InboxItem;
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const issueUrl = trimStr(body.issue_url, 500) ?? "";
      item.status = "resolved";
      item.resolution = { issue_url: issueUrl, resolved_at: new Date().toISOString() };
      await env.INBOX.put(key, JSON.stringify(item));
      return json(item);
    }

    if (pathname === "/admin/repos") {
      if (!adminAuth) return unauthorized();
      if (method === "GET") {
        return json({ repos: await readRepos(env) });
      }
      if (method === "PUT") {
        const body = (await req.json().catch(() => null)) as { repos?: unknown } | null;
        if (!body || !Array.isArray(body.repos)) {
          return json({ error: "body must be { repos: [{name, description?}] }" }, 400);
        }
        const cleaned: Repo[] = [];
        for (const r of body.repos) {
          if (typeof r !== "object" || r === null) continue;
          const name = trimStr((r as Repo).name, 200);
          if (!name) continue;
          const desc = trimStr((r as Repo).description, 500);
          cleaned.push(desc ? { name, description: desc } : { name });
        }
        await env.INBOX.put(REPOS_KEY, JSON.stringify(cleaned));
        return json({ repos: cleaned });
      }
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
