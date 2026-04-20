import chokidar, { type FSWatcher } from "chokidar";
import { logger } from "@brain/shared";

const IGNORE_PATTERNS = [
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])\.git(?![/\\]HEAD|[/\\]refs)/,
  /(^|[/\\])dist([/\\]|$)/,
  /(^|[/\\])\.next([/\\]|$)/,
  /(^|[/\\])target([/\\]|$)/,
  /(^|[/\\])\.turbo([/\\]|$)/,
  /(^|[/\\])\.venv([/\\]|$)/,
  /(^|[/\\])__pycache__([/\\]|$)/,
  /(^|[/\\])\.DS_Store$/,
];

export interface WatchOptions {
  roots: string[];
  onProjectActivity: (path: string) => void;
  /** ms to wait before firing onProjectActivity for a given path. */
  debounceMs?: number;
}

export class WatchManager {
  private watcher?: FSWatcher;
  private timers = new Map<string, NodeJS.Timeout>();
  private readonly debounceMs: number;
  private readonly roots: string[];
  private readonly onActivity: (path: string) => void;

  constructor(opts: WatchOptions) {
    this.roots = opts.roots;
    this.onActivity = opts.onProjectActivity;
    this.debounceMs = opts.debounceMs ?? 2_000;
  }

  async start(): Promise<void> {
    if (this.roots.length === 0) {
      logger.warn("no roots to watch");
      return;
    }
    this.watcher = chokidar.watch(this.roots, {
      ignored: (p: string) => IGNORE_PATTERNS.some((r) => r.test(p)),
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
      depth: 10,
    });

    const fire = (p: string) => this.debounced(p);
    this.watcher.on("add", fire);
    this.watcher.on("change", fire);
    this.watcher.on("unlink", fire);
    this.watcher.on("addDir", fire);
    this.watcher.on("unlinkDir", fire);
    this.watcher.on("error", (err) => {
      logger.error({ err }, "watcher error");
    });

    await new Promise<void>((resolve) => {
      this.watcher!.once("ready", () => resolve());
    });
    logger.info({ roots: this.roots }, "watch manager ready");
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
  }

  private debounced(path: string): void {
    const existing = this.timers.get(path);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(path);
      try {
        this.onActivity(path);
      } catch (err) {
        logger.error({ err, path }, "onProjectActivity handler threw");
      }
    }, this.debounceMs);
    this.timers.set(path, timer);
  }

  get watching(): string[] {
    return [...this.roots];
  }

  get pending(): number {
    return this.timers.size;
  }
}
