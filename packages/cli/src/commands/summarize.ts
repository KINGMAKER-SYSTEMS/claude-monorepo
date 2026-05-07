import type { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { summarizeProjects, type SummarizeOptions } from "@brain/embedder";

export interface SummarizeCliOptions {
  limit?: number;
  model?: string;
  force?: boolean;
  json?: boolean;
}

export async function runSummarize(opts: SummarizeCliOptions): Promise<number> {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    if (opts.json) {
      console.log(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }));
    } else {
      console.error(pc.red("error:"), "ANTHROPIC_API_KEY is not set");
      console.error(pc.dim("  set it in your shell or in .env, then re-run"));
    }
    return 1;
  }

  const callOpts: SummarizeOptions = {};
  if (opts.limit !== undefined) callOpts.limit = opts.limit;
  if (opts.model !== undefined) callOpts.model = opts.model;
  if (opts.force) callOpts.skipIfFresh = false;

  if (opts.json) {
    const res = await summarizeProjects(callOpts);
    console.log(JSON.stringify(res));
    return 0;
  }

  const spin = p.spinner();
  spin.start("summarizing projects…");
  try {
    const res = await summarizeProjects(callOpts);
    spin.stop(
      pc.green(
        `${res.summarized} summarized · ${res.skipped} skipped · ${res.embedded} embedded`,
      ),
    );
    return 0;
  } catch (err) {
    spin.stop(pc.red("summarize failed"));
    console.error(pc.red("error:"), err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export function registerSummarize(program: Command): void {
  program
    .command("summarize")
    .description("generate LLM project summaries (Claude) and embed them for `brain ask`")
    .option("-n, --limit <n>", "max projects to consider", (v) => Number(v))
    .option("-m, --model <id>", "Claude model id (default claude-haiku-4-5-20251001)")
    .option("--force", "re-summarize even if the source fingerprint is unchanged")
    .option("--json", "emit JSON instead of rendered text")
    .action(async (opts: SummarizeCliOptions) => {
      const code = await runSummarize(opts);
      if (code !== 0) process.exitCode = code;
    });
}
