#!/usr/bin/env tsx
import { Command } from "commander";
import pc from "picocolors";
import { closeDb } from "@brain/db";
import { registerInit } from "./commands/init.js";
import { registerProjects } from "./commands/projects.js";
import { registerProject } from "./commands/project.js";
import { registerDeps } from "./commands/deps.js";
import { registerGit } from "./commands/git.js";
import { registerSearch } from "./commands/search.js";
import { registerScan } from "./commands/scan.js";
import { registerStandup } from "./commands/standup.js";
import { registerTranscripts } from "./commands/transcripts.js";
import { registerAlerts } from "./commands/alerts.js";
import { registerWatch } from "./commands/watch.js";
import { registerAsk } from "./commands/ask.js";

const program = new Command();

program
  .name("brain")
  .description(pc.cyan("Claude Superbrain — actionable full-stack observability for your dev life"))
  .version("0.0.2");

registerStandup(program);
registerInit(program);
registerProjects(program);
registerProject(program);
registerAlerts(program);
registerTranscripts(program);
registerDeps(program);
registerGit(program);
registerSearch(program);
registerScan(program);
registerWatch(program);
registerAsk(program);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } finally {
    await closeDb().catch(() => void 0);
  }
}

main().catch((err) => {
  console.error(pc.red("error:"), err instanceof Error ? err.message : err);
  process.exit(1);
});
