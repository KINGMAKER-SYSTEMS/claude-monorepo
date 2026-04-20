import type { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "@brain/shared";
import { discoverProjects } from "@brain/indexer/discovery";
import { scanMany, scanProject } from "@brain/indexer/scan";
import { syncTranscripts } from "@brain/indexer";
import { syncLocalInfra } from "@brain/indexer/infra-sync";
import { deriveAlerts } from "@brain/indexer";

export function registerScan(program: Command): void {
  program
    .command("scan [path]")
    .description("scan a single path, or re-scan every configured root when omitted")
    .option("--no-transcripts", "skip Claude Code transcript sync")
    .option("--no-infra", "skip docker + dev-server scan")
    .option("--no-alerts", "skip alert derivation")
    .action(async (path: string | undefined, opts: { transcripts: boolean; infra: boolean; alerts: boolean }) => {
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
      } else {
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
      }

      if (opts.transcripts !== false) {
        const tspin = p.spinner();
        tspin.start("syncing Claude Code transcripts…");
        const res = await syncTranscripts();
        tspin.stop(
          pc.green(
            `${res.sessionsSeen} session(s) seen · ${res.sessionsUpserted} upserted · ${res.openLoopsInserted} open loop(s)`,
          ),
        );
      }

      if (opts.infra !== false) {
        const ispin = p.spinner();
        ispin.start("scanning docker + dev servers…");
        const res = await syncLocalInfra();
        ispin.stop(
          pc.green(
            `${res.containers} container(s) · ${res.devServers} dev server(s) · ${res.stopped} stopped`,
          ),
        );
        if (res.errors.length > 0) {
          for (const e of res.errors) console.log(pc.dim(`   ${e}`));
        }
      }

      if (opts.alerts !== false) {
        const aspin = p.spinner();
        aspin.start("deriving alerts…");
        const res = await deriveAlerts();
        aspin.stop(pc.green(`${res.opened} opened · ${res.resolved} resolved`));
      }
    });
}
