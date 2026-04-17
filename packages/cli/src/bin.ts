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

const program = new Command();

program
  .name("brain")
  .description(pc.cyan("Claude Superbrain — your project & infra map"))
  .version("0.0.1");

registerInit(program);
registerProjects(program);
registerProject(program);
registerDeps(program);
registerGit(program);
registerSearch(program);
registerScan(program);

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
