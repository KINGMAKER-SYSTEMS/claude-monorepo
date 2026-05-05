import type { Command } from "commander";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pc from "picocolors";

// `brain mcp` starts the stdio MCP server. It simply exec's the @brain/mcp
// bin — we don't embed the server in this process because the CLI prints to
// stdout during normal use, which would corrupt the JSON-RPC stream.

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description("start the MCP server on stdio (for Claude Desktop / MCP clients)")
    .action(() => {
      // Resolve the mcp package's bin entry relative to this file. In dev
      // (tsx) we point at src/bin.ts; in dist we point at dist/bin.js.
      const here = dirname(fileURLToPath(import.meta.url));
      // here = .../packages/cli/src/commands → up to repo then into packages/mcp
      const devBin = resolve(here, "../../../mcp/src/bin.ts");
      const proc = spawn("tsx", [devBin], {
        stdio: "inherit",
        env: process.env,
      });
      proc.on("exit", (code) => process.exit(code ?? 0));
      proc.on("error", (err) => {
        console.error(pc.red("failed to start brain-mcp:"), err.message);
        process.exit(1);
      });
    });
}
