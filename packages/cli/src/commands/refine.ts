import type { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { refineOpenLoops, type RefineOptions } from "@brain/embedder";

export interface RefineCliOptions {
  limit?: number;
  model?: string;
  since?: string;
  json?: boolean;
}

export async function runRefine(opts: RefineCliOptions): Promise<number> {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    if (opts.json) {
      console.log(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }));
    } else {
      console.error(pc.red("error:"), "ANTHROPIC_API_KEY is not set");
      console.error(pc.dim("  set it in your shell or in .env, then re-run"));
    }
    return 1;
  }

  let since: Date | undefined;
  if (opts.since !== undefined) {
    const parsed = new Date(opts.since);
    if (Number.isNaN(parsed.getTime())) {
      const msg = `invalid --since date: ${opts.since}`;
      if (opts.json) console.log(JSON.stringify({ error: msg }));
      else console.error(pc.red("error:"), msg);
      return 1;
    }
    since = parsed;
  }

  const callOpts: RefineOptions = {};
  if (opts.limit !== undefined) callOpts.limit = opts.limit;
  if (opts.model !== undefined) callOpts.model = opts.model;
  if (since !== undefined) callOpts.since = since;

  if (opts.json) {
    const res = await refineOpenLoops(callOpts);
    console.log(JSON.stringify(res));
    return 0;
  }

  const spin = p.spinner();
  spin.start("refining open loops…");
  try {
    const res = await refineOpenLoops(callOpts);
    spin.stop(pc.green(`${res.refined} refined · ${res.embedded} embedded`));
    return 0;
  } catch (err) {
    spin.stop(pc.red("refine failed"));
    console.error(pc.red("error:"), err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export function registerRefine(program: Command): void {
  program
    .command("refine")
    .description("rewrite messy open loops into clean actionable next steps via Claude")
    .option("-n, --limit <n>", "max loops to refine in this run (default 50)", (v) => Number(v))
    .option("-m, --model <id>", "Claude model id (default claude-haiku-4-5-20251001)")
    .option("--since <date>", "ISO date; only refine loops newer than this")
    .option("--json", "emit JSON instead of rendered text")
    .action(async (opts: RefineCliOptions) => {
      const code = await runRefine(opts);
      if (code !== 0) process.exitCode = code;
    });
}
