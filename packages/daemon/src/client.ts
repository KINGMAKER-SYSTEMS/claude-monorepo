import {
  tryConnectIpcClient,
  defaultSocketPath,
  type IpcClient,
} from "./ipc.js";

/**
 * Thin typed wrapper over IpcClient for CLI callers. All methods return null
 * if the daemon isn't reachable — callers decide whether to fall back to
 * direct DB access.
 */
export interface DaemonStatusResponse {
  startedAt: string | null;
  uptimeMs: number;
  projectCount: number;
  watching: string[];
  pending: number;
  ticks: {
    periodic: { name: string; intervalMs: number; lastRunAt?: string; lastDurationMs?: number; running: boolean } | null;
    rediscover: { name: string; intervalMs: number; lastRunAt?: string; lastDurationMs?: number; running: boolean } | null;
  };
  socketPath: string;
  pid: number;
}

export class DaemonClient {
  constructor(private ipc: IpcClient) {}

  static async connect(socketPath = defaultSocketPath()): Promise<DaemonClient | null> {
    const ipc = await tryConnectIpcClient(socketPath);
    return ipc ? new DaemonClient(ipc) : null;
  }

  async ping(): Promise<{ ok: true; uptimeMs: number; version: string; pid: number; socketPath: string }> {
    return this.ipc.call("ping");
  }

  async status(): Promise<DaemonStatusResponse> {
    return this.ipc.call("status");
  }

  async projects(): Promise<Array<{ id: string; name: string; rootPath: string; kind: string }>> {
    return this.ipc.call("projects");
  }

  async rescan(params: { path?: string; projectId?: string } = {}): Promise<{ ok: true; scanned: number }> {
    return this.ipc.call("rescan", params);
  }

  async shutdown(): Promise<{ ok: true }> {
    return this.ipc.call("shutdown");
  }

  close(): void {
    this.ipc.close();
  }
}
