import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import pc from "picocolors";
import {
  runDaemon,
  DaemonClient,
  defaultSocketPath,
  defaultPidPath,
  defaultLogPath,
} from "@brain/daemon";
import { logger } from "@brain/shared";

interface WatchOptions {
  detach?: boolean;
  tickSec?: number;
  socket?: string;
}

export function registerWatch(program: Command): void {
  program
    .command("watch")
    .description("run the brain daemon (fs-watch + periodic scan)")
    .option("-d, --detach", "run in background")
    .option("--tick-sec <seconds>", "seconds between periodic ticks", (v) => Number(v))
    .option("--socket <path>", "override socket path")
    .action(async (opts: { detach?: boolean; tickSec?: number; socket?: string }) => {
      const w: WatchOptions = { detach: opts.detach ?? false };
      if (opts.tickSec !== undefined) w.tickSec = opts.tickSec;
      if (opts.socket !== undefined) w.socket = opts.socket;
      await watchCommand(w);
    });

  program
    .command("status")
    .description("show daemon status")
    .option("--socket <path>", "override socket path")
    .action(async (opts: { socket?: string }) => {
      const a: { socket?: string } = {};
      if (opts.socket !== undefined) a.socket = opts.socket;
      await statusCommand(a);
    });

  program
    .command("stop")
    .description("stop the brain daemon")
    .option("--socket <path>", "override socket path")
    .action(async (opts: { socket?: string }) => {
      const a: { socket?: string } = {};
      if (opts.socket !== undefined) a.socket = opts.socket;
      await stopCommand(a);
    });
}

export async function watchCommand(opts: WatchOptions = {}): Promise<void> {
  const socketPath = opts.socket ?? defaultSocketPath();
  mkdirSync(dirname(socketPath), { recursive: true });

  // Reject if another daemon is already responsive.
  const existing = await DaemonClient.connect(socketPath);
  if (existing) {
    existing.close();
    console.error(pc.yellow(`daemon already running on ${socketPath}`));
    console.error(pc.dim("   use `brain status` to inspect or `brain stop` to terminate it"));
    process.exit(1);
  }

  if (opts.detach) {
    await detachSelf(opts);
    return;
  }

  // Foreground mode
  console.log(pc.cyan("brain watch"));
  console.log(pc.dim(`   socket: ${socketPath}`));
  console.log(pc.dim(`   tick:   ${opts.tickSec ?? 60}s`));
  console.log(pc.dim("   Ctrl-C to stop"));

  writePid(defaultPidPath());

  try {
    await runDaemon({
      socketPath,
      tickIntervalSec: opts.tickSec ?? 60,
    });
    // runDaemon installs SIGINT/SIGTERM handlers that call process.exit.
    await new Promise<void>(() => {
      /* park forever */
    });
  } catch (err) {
    logger.error({ err }, "daemon failed to start");
    process.exit(1);
  }
}

export async function statusCommand(opts: { socket?: string } = {}): Promise<void> {
  const socketPath = opts.socket ?? defaultSocketPath();
  const client = await DaemonClient.connect(socketPath);
  if (!client) {
    console.log(pc.dim("daemon not running"));
    console.log(pc.dim(`   socket: ${socketPath}`));
    console.log(pc.dim("   start it with `brain watch --detach`"));
    return;
  }
  try {
    const s = await client.status();
    console.log(pc.bold(pc.cyan("brain daemon")));
    console.log(`  pid:        ${s.pid}`);
    console.log(`  started:    ${s.startedAt ?? "?"}`);
    console.log(`  uptime:     ${formatDuration(s.uptimeMs)}`);
    console.log(`  projects:   ${s.projectCount}`);
    console.log(`  watching:   ${s.watching.length} root(s)`);
    for (const r of s.watching) console.log(pc.dim(`              ${r}`));
    console.log(`  pending:    ${s.pending}`);
    const periodic = s.ticks.periodic;
    if (periodic) {
      console.log(
        `  tick:       ${pc.dim(`every ${Math.round(periodic.intervalMs / 1000)}s`)} · last ${
          periodic.lastRunAt ?? "never"
        }${periodic.lastDurationMs != null ? ` (${periodic.lastDurationMs}ms)` : ""}`,
      );
    }
    const rediscover = s.ticks.rediscover;
    if (rediscover) {
      console.log(
        `  rediscover: ${pc.dim(`every ${Math.round(rediscover.intervalMs / 1000)}s`)} · last ${
          rediscover.lastRunAt ?? "never"
        }`,
      );
    }
    console.log(`  socket:     ${pc.dim(s.socketPath)}`);
  } finally {
    client.close();
  }
}

export async function stopCommand(opts: { socket?: string; force?: boolean } = {}): Promise<void> {
  const socketPath = opts.socket ?? defaultSocketPath();
  const client = await DaemonClient.connect(socketPath);
  if (client) {
    try {
      await client.shutdown();
      console.log(pc.green("sent shutdown"));
    } catch (err) {
      console.error(pc.red("shutdown rpc failed"), err);
    } finally {
      client.close();
    }
    return;
  }

  // No socket — try PID file
  const pidPath = defaultPidPath();
  if (existsSync(pidPath)) {
    const pid = Number(readFileSync(pidPath, "utf8").trim());
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, "SIGTERM");
        console.log(pc.green(`sent SIGTERM to pid ${pid}`));
        try {
          unlinkSync(pidPath);
        } catch {
          /* ignore */
        }
        return;
      } catch (err) {
        console.error(pc.red(`kill failed:`), err);
      }
    }
  }
  console.log(pc.dim("no daemon to stop"));
}

function writePid(pidPath: string): void {
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, String(process.pid));
  process.on("exit", () => {
    try {
      unlinkSync(pidPath);
    } catch {
      /* ignore */
    }
  });
}

async function detachSelf(opts: WatchOptions): Promise<void> {
  const logPath = defaultLogPath();
  mkdirSync(dirname(logPath), { recursive: true });
  const out = openSync(logPath, "a");
  const err = openSync(logPath, "a");

  // Re-invoke ourselves. The parent was started via tsx (#!/usr/bin/env tsx
  // or `pnpm start`), so process.argv[1] is the .ts entrypoint and
  // process.argv[0] is node or tsx. Using the same argv ensures the child
  // loads TypeScript the same way the parent did.
  const binPath = fileURLToPath(new URL("../bin.ts", import.meta.url));
  const args = [binPath, "watch"];
  if (opts.tickSec) args.push("--tick-sec", String(opts.tickSec));
  if (opts.socket) args.push("--socket", opts.socket);

  // Use `tsx` from PATH since this CLI is already installed via pnpm which
  // hoists tsx into node_modules/.bin. If tsx isn't on PATH, fall back to
  // the node interpreter with tsx loader.
  const child = spawn("tsx", args, {
    detached: true,
    stdio: ["ignore", out, err],
    env: process.env,
  });
  child.unref();
  console.log(pc.green("daemon starting in background"));
  console.log(pc.dim(`   pid:  ${child.pid ?? "?"}`));
  console.log(pc.dim(`   log:  ${logPath}`));
  console.log(pc.dim(`   stop: brain stop`));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
