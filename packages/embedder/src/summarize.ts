import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@brain/db";
import { childLogger } from "@brain/shared";
import { embedAndStore } from "./store.js";
import { createEmbedder } from "./factory.js";

export interface SummarizeOptions {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Claude model id. Default claude-haiku-4-5-20251001 (cheap + fast). */
  model?: string;
  /** Only re-summarize if source facts changed. Default true. */
  skipIfFresh?: boolean;
  /** Max projects to summarize in this run. */
  limit?: number;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/**
 * Generate short summaries for projects using Claude. Writes the summary to
 * projects.summary and embeds it as `project_summary` so `brain ask` can find
 * it semantically. Idempotent: skips projects whose source fingerprint
 * matches summary_hash.
 */
export async function summarizeProjects(
  opts: SummarizeOptions = {},
): Promise<{ summarized: number; skipped: number; embedded: number }> {
  const log = childLogger({ scanner: "summarize" });
  const db = getDb();
  const apiKey = opts.apiKey ?? process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error("summarizer requires ANTHROPIC_API_KEY (or opts.apiKey)");
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const skipIfFresh = opts.skipIfFresh ?? true;

  const rows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      rootPath: schema.projects.rootPath,
      kind: schema.projects.kind,
      framework: schema.projects.framework,
      status: schema.projects.status,
      summary: schema.projects.summary,
      summaryHash: schema.projects.summaryHash,
      summarySource: schema.projects.summarySource,
      summaryGeneratedAt: schema.projects.summaryGeneratedAt,
      serviceTokens: schema.projects.serviceTokens,
      deployTargets: schema.projects.deployTargets,
      lastCommitAt: schema.projects.lastCommitAt,
      lastActivityAt: schema.projects.lastActivityAt,
      todoCount: schema.projects.todoCount,
    })
    .from(schema.projects)
    .limit(opts.limit ?? 200);

  let summarized = 0;
  let skipped = 0;
  const toEmbed: { ownerId: string; text: string }[] = [];

  for (const p of rows) {
    const facts = buildFacts(p);
    const fingerprint = hashFingerprint(facts);
    if (skipIfFresh && p.summaryHash === fingerprint && p.summary) {
      skipped++;
      toEmbed.push({ ownerId: p.id, text: p.summary });
      continue;
    }

    let summary: string;
    try {
      summary = await callClaude(apiKey, model, p.name, facts);
    } catch (err) {
      log.warn({ err: (err as Error).message, project: p.name }, "summarize failed");
      continue;
    }

    await db
      .update(schema.projects)
      .set({
        summary,
        summarySource: "llm",
        summaryHash: fingerprint,
        summaryGeneratedAt: new Date(),
      })
      .where(sql`${schema.projects.id} = ${p.id}`);
    summarized++;
    toEmbed.push({ ownerId: p.id, text: summary });
  }

  // Embed everything we touched (fresh + stale-but-unchanged).
  let embedded = 0;
  if (toEmbed.length > 0) {
    const embedder = createEmbedder();
    const batch = toEmbed.map((t) => ({
      ownerKind: "project_summary" as const,
      ownerId: t.ownerId,
      text: t.text,
    }));
    // chunk by 64 to keep the dedupe IN-list manageable
    for (let i = 0; i < batch.length; i += 64) {
      const slice = batch.slice(i, i + 64);
      const res = await embedAndStore(embedder, slice);
      embedded += res.stored;
    }
  }

  log.info({ summarized, skipped, embedded }, "summarize pass complete");
  return { summarized, skipped, embedded };
}

type ProjectFacts = ReturnType<typeof buildFacts>;

function buildFacts(p: {
  name: string;
  rootPath: string;
  kind: string;
  framework: string | null;
  status: string;
  serviceTokens: string[];
  deployTargets: string[];
  lastCommitAt: Date | null;
  lastActivityAt: Date | null;
  todoCount: number;
}) {
  return {
    name: p.name,
    path: p.rootPath,
    kind: p.kind,
    framework: p.framework,
    status: p.status,
    uses: p.serviceTokens,
    deploysTo: p.deployTargets,
    lastCommit: p.lastCommitAt?.toISOString() ?? null,
    lastActivity: p.lastActivityAt?.toISOString() ?? null,
    todoCount: p.todoCount,
  };
}

function hashFingerprint(f: ProjectFacts): string {
  // Omit time-flavored bits that drift constantly; keep the stable shape.
  const stable = {
    kind: f.kind,
    framework: f.framework,
    status: f.status,
    uses: [...f.uses].sort(),
    deploysTo: [...f.deploysTo].sort(),
    todoCount: f.todoCount,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 20);
}

async function callClaude(
  apiKey: string,
  model: string,
  name: string,
  facts: ProjectFacts,
): Promise<string> {
  const prompt = `You write one-paragraph summaries of software projects for a developer's "superbrain" memory.

Project: ${name}
Facts:
${JSON.stringify(facts, null, 2)}

Write 2-3 sentences (≤ 80 words total). Cover: what kind of project this is, the stack, and its current state. Don't invent facts that aren't in the input. Don't start with the project name or "This project". Be direct and declarative.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = json.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("anthropic returned empty text");
  return text;
}
