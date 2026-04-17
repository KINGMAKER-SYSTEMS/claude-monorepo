import type { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "@brain/shared";
import { discoverProjects } from "@brain/indexer/discovery";
import { scanMany, scanProject } from "@brain/indexer/scan";

export function registerScan(program: Command): void {
  program
    .command("scan [path]")
    .description("scan a single path, or re-scan every configured root when omitted")
    .action(async (path: string | undefined) => {
      if (path) {
        const detected = discoverProjects(path, { maxDepth: 1 });
        if (detected.length === 0) {
          console.log(pc.red(`no project detected at ${path}`));
          process.exitCode = 1;
          return;
        }
        const spin = p.spinner();
        spin.start(`scanning ${detected.length} project(s)…`);
        for (const d of detected) await scanProject(d);
        spin.stop(pc.green("scan complete"));
        return;
      }

      const cfg = loadConfig();
      if (cfg.roots.length === 0) {
        console.log(pc.red("no roots configured — run `brain init`"));
        process.exitCode = 1;
        return;
      }

      const spin = p.spinner();
      spin.start("discovering…");
      const detected = cfg.roots.flatMap((r) => discoverProjects(r.path, { maxDepth: cfg.maxDepth }));
      spin.stop(`${pc.bold(String(detected.length))} project(s) found`);

      const scanSpin = p.spinner();
      scanSpin.start("scanning…");
      const results = await scanMany(detected);
      scanSpin.stop(pc.green(`scanned ${results.length} project(s)`));
    });
}
