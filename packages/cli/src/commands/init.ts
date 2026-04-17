import type { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import {
  CANDIDATE_ROOTS,
  defaultConfigPath,
  expandHome,
  loadConfig,
  saveConfig,
  type BrainConfig,
} from "@brain/shared";
import { discoverProjects } from "@brain/indexer/discovery";
import { scanMany } from "@brain/indexer/scan";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("discover and register project roots, then scan everything found")
    .option("--no-scan", "only write config, don't scan yet")
    .action(async (opts: { scan: boolean }) => {
      p.intro(pc.bgCyan(pc.black(" brain init ")));

      const config = loadConfig();
      const existing = new Set(config.roots.map((r) => r.path));

      const candidates = CANDIDATE_ROOTS.map(expandHome).filter(
        (path) => existsSync(path) && !existing.has(path),
      );

      let chosen: string[] = [];
      if (candidates.length > 0) {
        const picked = await p.multiselect({
          message: "Which roots should brain watch?",
          options: candidates.map((c) => ({ value: c, label: c })),
          required: false,
        });
        if (p.isCancel(picked)) {
          p.cancel("aborted");
          return;
        }
        chosen = picked as string[];
      } else {
        p.note("No common project roots found under $HOME.", "heads up");
      }

      const extra = await p.text({
        message: "Add another root? (leave blank to finish)",
        placeholder: "/Users/you/some-folder",
      });
      if (p.isCancel(extra)) {
        p.cancel("aborted");
        return;
      }
      if (typeof extra === "string" && extra.trim().length > 0) {
        chosen.push(expandHome(extra.trim()));
      }

      const next: BrainConfig = {
        ...config,
        roots: [
          ...config.roots,
          ...chosen.map((path) => ({ path, tags: [], excludes: [] })),
        ],
      };
      saveConfig(next);
      p.log.success(`saved ${pc.bold(defaultConfigPath())}`);

      if (!opts.scan) {
        p.outro("config written — run `brain scan` when you're ready.");
        return;
      }

      const roots = next.roots.map((r) => r.path);
      if (roots.length === 0) {
        p.outro("no roots configured — nothing to scan.");
        return;
      }

      const spinner = p.spinner();
      spinner.start("discovering projects…");
      const detected = roots.flatMap((r) => discoverProjects(r, { maxDepth: next.maxDepth }));
      spinner.stop(`found ${pc.bold(String(detected.length))} project(s)`);

      if (detected.length === 0) {
        p.outro("no projects detected.");
        return;
      }

      const scanSpin = p.spinner();
      scanSpin.start("scanning…");
      const results = await scanMany(detected);
      scanSpin.stop(`scanned ${pc.bold(String(results.length))} project(s)`);

      p.outro(pc.green("done. try `brain projects`"));
    });
}
