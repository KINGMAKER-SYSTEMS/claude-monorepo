import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { sql } from "drizzle-orm";
import pc from "picocolors";
import { getDb } from "@brain/db";
import { DaemonClient, defaultSocketPath } from "@brain/daemon";
import { createEmbedder, loadEmbedderConfig } from "@brain/embedder";

type Status = "ok" | "warn" | "fail";

interface CheckResult {
  name: string;
  status: Status;
  detail?: string;
  hint?: string;
}

interface DoctorOptions {
  json?: boolean;
  skipEmbedder?: boolean;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("verify daily-use prerequisites: DB, migrations, daemon, embedder, API keys")
    .option("--json", "emit JSON instead of rendered text")
    .option("--skip-embedder", "don't call the embedder (skips network round-trip)")
    .action(async (opts: DoctorOptions) => {
      const results: CheckResult[] = [];

      results.push(await checkDatabaseReachable());
      results.push(await checkMigrationsApplied());
      results.push(await checkProjectsDiscovered());
      results.push(await checkDaemonRunning());
      results.push(checkEmbedderConfig());
      if (!opts.skipEmbedder) {
        results.push(await checkEmbedderLive());
      }
      results.push(checkAnthropicKey());
      results.push(await checkRecentActivity());
      results.push(checkOllamaReachable());

      if (opts.json) {
        const summary = summarize(results);
        console.log(JSON.stringify({ summary, checks: results }, null, 2));
        process.exit(summary.fail > 0 ? 1 : 0);
      }

      const summary = summarize(results);
      console.log(pc.bold(pc.cyan("brain doctor")));
      console.log("");
      for (const r of results) {
        const icon = r.status === "ok" ? pc.green("✓") : r.status === "warn" ? pc.yellow("!") : pc.red("✗");
        console.log(`  ${icon}  ${pc.bold(r.name)}`);
        if (r.detail) console.log(`      ${pc.dim(r.detail)}`);
        if (r.hint && r.status !== "ok") console.log(`      ${pc.dim("→ " + r.hint)}`);
      }
      console.log("");
      const line = `${summary.ok} ok · ${summary.warn} warn · ${summary.fail} fail`;
      const color = summary.fail > 0 ? pc.red : summary.warn > 0 ? pc.yellow : pc.green;
      console.log(color(line));

      process.exit(summary.fail > 0 ? 1 : 0);
    });
}

function summarize(results: CheckResult[]): { ok: number; warn: number; fail: number } {
  const out = { ok: 0, warn: 0, fail: 0 };
  for (const r of results) out[r.status]++;
  return out;
}

async function checkDatabaseReachable(): Promise<CheckResult> {
  try {
    const db = getDb();
    const res = await db.execute(sql`SELECT version() AS v`);
    const rows = extractRows(res);
    const version = String(rows[0]?.["v"] ?? "").split(" ").slice(0, 2).join(" ");
    return { name: "database reachable", status: "ok", detail: version };
  } catch (err) {
    return {
      name: "database reachable",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      hint: "start postgres with `pnpm db:up` and check DATABASE_URL in .env",
    };
  }
}

async function checkMigrationsApplied(): Promise<CheckResult> {
  try {
    const db = getDb();
    // We don't have a migrations table (manual psql pipeline), so we probe
    // for known schema elements from each migration.
    const probes: Array<{ migration: string; probe: ReturnType<typeof sql> }> = [
      { migration: "0001_initial", probe: sql`SELECT 1 FROM projects LIMIT 0` },
      { migration: "0002_observability", probe: sql`SELECT summary FROM projects LIMIT 0` },
      { migration: "0003_phase2", probe: sql`SELECT 1 FROM daemon_state LIMIT 0` },
      {
        migration: "0004_embedding_768",
        probe: sql`SELECT embedding_768 FROM embeddings LIMIT 0`,
      },
      {
        migration: "0005_dedupe_full_unique",
        // Non-partial unique index = no WHERE clause in indexdef. Fails if
        // the old partial index is still in place.
        probe: sql`SELECT 1 / COUNT(*)::int FROM pg_indexes WHERE indexname = 'open_loops_dedupe' AND indexdef NOT ILIKE '%where%'`,
      },
      {
        migration: "0006_open_loops_refined",
        probe: sql`SELECT refined_text FROM open_loops LIMIT 0`,
      },
    ];
    const missing: string[] = [];
    for (const { migration, probe } of probes) {
      try {
        await db.execute(probe);
      } catch {
        missing.push(migration);
      }
    }
    if (missing.length === 0) {
      return { name: "migrations applied", status: "ok", detail: "0001–0006" };
    }
    return {
      name: "migrations applied",
      status: "fail",
      detail: `missing: ${missing.join(", ")}`,
      hint: "run `pnpm db:migrate`",
    };
  } catch (err) {
    return {
      name: "migrations applied",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      hint: "run `pnpm db:migrate`",
    };
  }
}

async function checkProjectsDiscovered(): Promise<CheckResult> {
  try {
    const db = getDb();
    const res = await db.execute(sql`SELECT count(*)::int AS n FROM projects`);
    const rows = extractRows(res);
    const count = Number(rows[0]?.["n"] ?? 0);
    if (count === 0) {
      return {
        name: "projects discovered",
        status: "warn",
        detail: "0 projects in DB",
        hint: "run `brain init` to discover projects under ~/code, ~/work",
      };
    }
    return { name: "projects discovered", status: "ok", detail: `${count} project(s)` };
  } catch (err) {
    return {
      name: "projects discovered",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkDaemonRunning(): Promise<CheckResult> {
  const socketPath = defaultSocketPath();
  const client = await DaemonClient.connect(socketPath);
  if (!client) {
    return {
      name: "daemon running",
      status: "warn",
      detail: "not running",
      hint: "start it with `brain watch --detach`",
    };
  }
  try {
    const s = await client.status();
    const uptimeMin = Math.floor(s.uptimeMs / 60_000);
    return {
      name: "daemon running",
      status: "ok",
      detail: `pid ${s.pid} · up ${uptimeMin}m · watching ${s.watching.length}`,
    };
  } catch (err) {
    return {
      name: "daemon running",
      status: "warn",
      detail: err instanceof Error ? err.message : String(err),
      hint: "daemon responded but status call failed — try `brain stop && brain watch --detach`",
    };
  } finally {
    client.close();
  }
}

function checkEmbedderConfig(): CheckResult {
  const configPath = join(homedir(), ".config", "brain", "config.toml");
  const cfg = loadEmbedderConfig();
  const exists = existsSync(configPath);
  if (!exists && cfg.kind === "openai") {
    return {
      name: "embedder configured",
      status: "warn",
      detail: "using default (openai), no config.toml present",
      hint: `write ${configPath} to switch to ollama/voyage`,
    };
  }
  return {
    name: "embedder configured",
    status: "ok",
    detail: `${cfg.kind}${cfg.model ? ` · ${cfg.model}` : ""}${cfg.dim ? ` · dim ${cfg.dim}` : ""}`,
  };
}

async function checkEmbedderLive(): Promise<CheckResult> {
  try {
    const embedder = createEmbedder();
    const res = await embedder.embed({ inputs: ["doctor probe"] });
    const vec = res.vectors[0];
    if (!vec || vec.length === 0) {
      return {
        name: "embedder live",
        status: "fail",
        detail: "no vector returned",
      };
    }
    return {
      name: "embedder live",
      status: "ok",
      detail: `${res.provider} · ${res.modelId} · dim ${vec.length}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = msg.toLowerCase().includes("api key")
      ? "set OPENAI_API_KEY / VOYAGE_API_KEY in your shell"
      : msg.includes("ECONNREFUSED") || msg.includes("fetch failed")
      ? "if using ollama: `ollama serve` · if openai/voyage: check network"
      : "check embedder config + credentials";
    return { name: "embedder live", status: "fail", detail: msg.slice(0, 140), hint };
  }
}

function checkAnthropicKey(): CheckResult {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) {
    return {
      name: "ANTHROPIC_API_KEY",
      status: "ok",
      detail: "not set (optional)",
      hint: "summaries via Claude Desktop MCP instead; set only if you want headless `brain summarize`",
    };
  }
  return { name: "ANTHROPIC_API_KEY", status: "ok", detail: `set (${key.slice(0, 10)}…)` };
}

async function checkRecentActivity(): Promise<CheckResult> {
  try {
    const db = getDb();
    const res = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM scan_runs WHERE started_at > now() - interval '7 days') AS scans,
        (SELECT count(*)::int FROM alerts WHERE status = 'open') AS open_alerts,
        (SELECT count(*)::int FROM embeddings) AS embeddings
    `);
    const rows = extractRows(res);
    const scans = Number(rows[0]?.["scans"] ?? 0);
    const alerts = Number(rows[0]?.["open_alerts"] ?? 0);
    const embeddings = Number(rows[0]?.["embeddings"] ?? 0);

    if (scans === 0 && embeddings === 0) {
      return {
        name: "data freshness",
        status: "warn",
        detail: "no scans in last 7d, no embeddings",
        hint: "run `brain scan && brain summarize`",
      };
    }
    return {
      name: "data freshness",
      status: "ok",
      detail: `${scans} scan(s)/7d · ${alerts} open alert(s) · ${embeddings} embedding(s)`,
    };
  } catch (err) {
    return {
      name: "data freshness",
      status: "warn",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkOllamaReachable(): CheckResult {
  const cfg = loadEmbedderConfig();
  if (cfg.kind !== "ollama") {
    return { name: "ollama endpoint", status: "ok", detail: "not in use (skipped)" };
  }
  // We can't easily do a sync check from the doctor, so just surface the
  // endpoint so the user knows what to test. The embedder-live check above
  // covers the actual round-trip.
  const endpoint = cfg.endpoint ?? "http://127.0.0.1:11434";
  return {
    name: "ollama endpoint",
    status: "ok",
    detail: endpoint,
  };
}

function extractRows(result: unknown): Array<Record<string, unknown>> {
  const r = result as { rows?: Array<Record<string, unknown>> };
  if (Array.isArray(r.rows)) return r.rows;
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return [];
}
