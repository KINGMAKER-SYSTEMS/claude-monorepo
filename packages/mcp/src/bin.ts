#!/usr/bin/env tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeDb } from "@brain/db";
import { buildServer } from "./server.js";

// stdio MCP servers communicate on stdin/stdout. Any stray writes to stdout
// will corrupt the JSON-RPC stream, so nothing in this process should call
// console.log — use console.error (stderr) only when surfacing diagnostics.

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      await closeDb().catch(() => void 0);
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}

main().catch((err) => {
  console.error("brain-mcp fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
