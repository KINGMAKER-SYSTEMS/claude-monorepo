import { logger } from "@brain/shared";

export type TickFn = () => Promise<void>;

/**
 * Periodic runner. Guarantees no overlapping runs of the same tick:
 * if a tick is still running when the interval fires, the next run is
 * skipped (not queued). Prevents slow scans from stacking up.
 */
export class TickScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  private lastRunAt: Date | undefined;
  private lastDurationMs: number | undefined;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly fn: TickFn,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Fire once immediately so we don't wait for the full interval on boot.
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // Wait for any in-flight run to finish (bounded by the longest scan).
    while (this.running) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async triggerNow(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    const started = Date.now();
    try {
      await this.fn();
      this.lastRunAt = new Date();
      this.lastDurationMs = Date.now() - started;
      logger.debug({ name: this.name, ms: this.lastDurationMs }, "tick ok");
    } catch (err) {
      logger.error({ err, name: this.name }, "tick failed");
    } finally {
      this.running = false;
    }
  }

  get stats() {
    return {
      name: this.name,
      intervalMs: this.intervalMs,
      lastRunAt: this.lastRunAt,
      lastDurationMs: this.lastDurationMs,
      running: this.running,
    };
  }
}
