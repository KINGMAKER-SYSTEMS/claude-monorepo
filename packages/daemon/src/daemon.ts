import { sep } from "node:path";
import { eq } from "drizzle-orm";
import {
  childLogger,
  loadConfig,
  logger,
  type DetectedProject,
} from "@brain/shared";
import { getDb, schema, closeDb } from "@brain/db";
import { discoverProjects } from "@brain/indexer/discovery";
import { scanMany, scanProject } from "@brain/indexer/scan";
import { deriveAlerts } from "@brain/indexer/alerts";
import { syncTranscripts } from "@brain/indexer/transcript-sync";
import { syncLocalInfra } from "@brain/indexer/infra-sync";
import {
  startIpcServer,
  defaultSocketPath,
  type IpcServer,
  type RpcHandler,
} from "./ipc.js";
import { WatchManager } from "./watch.js";
import { TickScheduler } from "./tick.js";
import { updateDaemonState, clearDaemonState } from "./state.js";

export interface DaemonOptions {
  socketPath?: string;
  /** seconds between periodic ticks (transcripts, alerts, infra). Default 60. */
  tickIntervalSec?: number;
  /** seconds between full rediscovery walks. Default 21600 (6h). */
  rediscoverIntervalSec?: number;
  /** debounce for fs events per project root. Default 2000ms. */
  watchDebounceMs?: number;
}

export class BrainDaemon {
  private readonly socketPath: string;
  private readonly tickIntervalSec: number;
  private readonly rediscoverIntervalSec: number;
  private readonly watchDebounceMs: number;

  private projects: DetectedProject[] = [];
  private watch?: WatchManager;
  private tickPeriodic?: TickScheduler;
  private tickRediscover?: TickScheduler;
  private ipc?: IpcServer;
  private started = false;
  private startedAt?: Date;

  // Path → debounced rescan promise, so we coalesce rescan requests.
  private rescanInFlight = new Map<string, Promise<void>>();

  constructor(opts: DaemonOptions = {}) {
    this.socketPath = opts.socketPath ?? defaultSocketPath();
    this.tickIntervalSec = opts.tickIntervalSec ?? 60;
    this.rediscoverIntervalSec = opts.rediscoverIntervalSec ?? 6 * 60 * 60;
    this.watchDebounceMs = opts.watchDebounceMs ?? 2_000;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("daemon already started");
    this.started = true;
    this.startedAt = new Date();

    const cfg = loadConfig();
    const rootPaths = cfg.roots.map((r) => r.path);
    const log = childLogger({ sub: "daemon" });
    log.info({ roots: rootPaths }, "daemon starting");

    // Initial discovery to populate project list and seed DB.
    this.projects = await this.rediscover(rootPaths);
    log.info({ count: this.projects.length }, "discovered projects");
    await scanMany(this.projects);

    const db = getDb();
    await updateDaemonState(db, {
      pid: process.pid,
      socketPath: this.socketPath,
      watching: rootPaths,
    });

    // IPC first so CLI can talk to us even while ticks are warming up.
    this.ipc = await startIpcServer(this.socketPath, this.makeHandler());

    // Watch for fs changes under each root.
    this.watch = new WatchManager({
      roots: rootPaths,
      debounceMs: this.watchDebounceMs,
      onProjectActivity: (path) => {
        void this.onFsActivity(path);
      },
    });
    await this.watch.start();

    // Periodic tick: transcripts + alerts + (later) infra.
    this.tickPeriodic = new TickScheduler("periodic", this.tickIntervalSec * 1000, async () => {
      await this.runPeriodicTick();
    });
    this.tickPeriodic.start();

    // Rediscovery tick: full walk for newly-added repos.
    this.tickRediscover = new TickScheduler(
      "rediscover",
      this.rediscoverIntervalSec * 1000,
      async () => {
        this.projects = await this.rediscover(rootPaths);
        await scanMany(this.projects);
      },
    );
    this.tickRediscover.start();

    log.info("daemon ready");
  }

  async stop(): Promise<void> {
    const log = childLogger({ sub: "daemon" });
    log.info("daemon stopping");

    await this.tickPeriodic?.stop();
    await this.tickRediscover?.stop();
    await this.watch?.stop();
    await this.ipc?.close();

    try {
      await clearDaemonState(getDb());
    } catch {
      /* ignore */
    }
    await closeDb();

    log.info("daemon stopped");
  }

  private makeHandler(): RpcHandler {
    return async (method: string, params: unknown): Promise<unknown> => {
      switch (method) {
        case "ping":
          return this.handlePing();
        case "status":
          return this.handleStatus();
        case "projects":
          return this.handleProjects();
        case "rescan":
          return this.handleRescan(params);
        case "shutdown":
          // Respond first; actual shutdown happens on process signal.
          setImmediate(() => process.kill(process.pid, "SIGTERM"));
          return { ok: true };
        default:
          throw new Error(`unknown_method: ${method}`);
      }
    };
  }

  private async handlePing(): Promise<{
    ok: true;
    uptimeMs: number;
    version: string;
    pid: number;
    socketPath: string;
  }> {
    return {
      ok: true,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      version: "phase2",
      pid: process.pid,
      socketPath: this.socketPath,
    };
  }

  private async handleStatus(): Promise<unknown> {
    return {
      startedAt: this.startedAt?.toISOString() ?? null,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      projectCount: this.projects.length,
      watching: this.watch?.watching ?? [],
      pending: this.watch?.pending ?? 0,
      ticks: {
        periodic: this.tickPeriodic?.stats ?? null,
        rediscover: this.tickRediscover?.stats ?? null,
      },
      socketPath: this.socketPath,
      pid: process.pid,
    };
  }

  private async handleProjects(): Promise<
    Array<{ id: string; name: string; rootPath: string; kind: string }>
  > {
    const db = getDb();
    const rows = await db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        rootPath: schema.projects.rootPath,
        kind: schema.projects.kind,
      })
      .from(schema.projects);
    return rows;
  }

  private async handleRescan(params: unknown): Promise<{ ok: true; scanned: number }> {
    const p = (params ?? {}) as { path?: string; projectId?: string };
    if (p.path) {
      const project = this.findProjectForPath(p.path);
      if (!project) return { ok: true, scanned: 0 };
      await this.rescanProject(project);
      return { ok: true, scanned: 1 };
    }
    if (p.projectId) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, p.projectId));
      if (!row) return { ok: true, scanned: 0 };
      const project: DetectedProject = {
        name: row.name,
        rootPath: row.rootPath,
        kind: row.kind,
        hasGit: true,
      };
      await this.rescanProject(project);
      return { ok: true, scanned: 1 };
    }
    // No arg → rescan everything.
    await scanMany(this.projects);
    return { ok: true, scanned: this.projects.length };
  }

  private onFsActivity(path: string): void {
    const project = this.findProjectForPath(path);
    if (!project) return;
    const log = childLogger({ sub: "daemon", project: project.name });
    log.debug({ path }, "fs activity → rescan");
    void this.rescanProject(project).catch((err) => {
      log.error({ err }, "rescan failed");
    });

    // Touch daemon_state so `brain status` shows liveness.
    void updateDaemonState(getDb(), { lastEventAt: new Date() });
  }

  private rescanProject(project: DetectedProject): Promise<void> {
    const inFlight = this.rescanInFlight.get(project.rootPath);
    if (inFlight) return inFlight;
    const p = (async () => {
      try {
        await scanProject(project);
      } finally {
        this.rescanInFlight.delete(project.rootPath);
      }
    })();
    this.rescanInFlight.set(project.rootPath, p);
    return p;
  }

  private async runPeriodicTick(): Promise<void> {
    const db = getDb();
    try {
      await syncTranscripts();
    } catch (err) {
      logger.error({ err }, "transcript sync failed");
    }
    try {
      await syncLocalInfra();
    } catch (err) {
      logger.error({ err }, "infra sync failed");
    }
    try {
      await deriveAlerts();
    } catch (err) {
      logger.error({ err }, "alert derivation failed");
    }
    await updateDaemonState(db, {
      lastTickAt: new Date(),
      watching: this.watch?.watching ?? [],
      scanQueue: this.rescanInFlight.size,
    });
  }

  private async rediscover(roots: string[]): Promise<DetectedProject[]> {
    const out: DetectedProject[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
      for (const p of discoverProjects(root)) {
        if (seen.has(p.rootPath)) continue;
        seen.add(p.rootPath);
        out.push(p);
      }
    }
    return out;
  }

  private findProjectForPath(path: string): DetectedProject | null {
    // Longest-prefix match so nested projects win over their parent root.
    let best: DetectedProject | null = null;
    let bestLen = -1;
    const candidate = path.endsWith(sep) ? path : path + sep;
    for (const p of this.projects) {
      const root = p.rootPath.endsWith(sep) ? p.rootPath : p.rootPath + sep;
      if (candidate.startsWith(root) && root.length > bestLen) {
        best = p;
        bestLen = root.length;
      }
    }
    return best;
  }
}

export async function runDaemon(opts?: DaemonOptions): Promise<BrainDaemon> {
  const daemon = new BrainDaemon(opts);
  await daemon.start();

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "received signal, shutting down");
    try {
      await daemon.stop();
    } catch (err) {
      logger.error({ err }, "error during shutdown");
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  return daemon;
}
