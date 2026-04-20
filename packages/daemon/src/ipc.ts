import { createServer, createConnection, type Server, type Socket } from "node:net";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";
import { logger } from "@brain/shared";

// Newline-delimited JSON over Unix socket.
// Frame cap protects the server from malformed clients that never send a newline.
const MAX_FRAME_BYTES = 1 << 20; // 1 MB

export interface RpcRequest {
  id: string;
  method: string;
  params?: unknown;
}

export interface RpcResponseOk {
  id: string;
  result: unknown;
}

export interface RpcResponseErr {
  id: string;
  error: { code: string; message: string; data?: unknown };
}

export type RpcResponse = RpcResponseOk | RpcResponseErr;

export type RpcHandler = (method: string, params: unknown) => Promise<unknown>;

export interface IpcServer {
  readonly socketPath: string;
  close(): Promise<void>;
}

export async function startIpcServer(
  socketPath: string,
  handle: RpcHandler,
): Promise<IpcServer> {
  mkdirSync(dirname(socketPath), { recursive: true });

  if (existsSync(socketPath)) {
    // Probe by connecting; if the peer is gone, unlink the orphaned file.
    const live = await new Promise<boolean>((resolve) => {
      const probe = createConnection(socketPath);
      probe.once("connect", () => {
        probe.destroy();
        resolve(true);
      });
      probe.once("error", () => resolve(false));
    });
    if (live) {
      throw new Error(`socket already in use: ${socketPath}`);
    }
    try {
      unlinkSync(socketPath);
    } catch {
      /* ignore */
    }
  }

  const server: Server = createServer((sock) => {
    setupConnection(sock, handle);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  logger.info({ socketPath }, "ipc server listening");

  return {
    socketPath,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      try {
        unlinkSync(socketPath);
      } catch {
        /* ignore */
      }
    },
  };
}

function setupConnection(sock: Socket, handle: RpcHandler): void {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (chunk: string) => {
    buf += chunk;
    if (buf.length > MAX_FRAME_BYTES) {
      logger.warn({ size: buf.length }, "ipc frame exceeded cap; dropping connection");
      sock.destroy();
      return;
    }
    let idx = buf.indexOf("\n");
    while (idx !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      handleFrame(sock, line, handle).catch((err) => {
        logger.error({ err }, "unhandled ipc frame error");
      });
      idx = buf.indexOf("\n");
    }
  });
  sock.on("error", (err) => {
    logger.debug({ err: err.message }, "ipc client socket error");
  });
}

async function handleFrame(sock: Socket, line: string, handle: RpcHandler): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: RpcRequest;
  try {
    req = JSON.parse(trimmed) as RpcRequest;
  } catch {
    write(sock, { id: "", error: { code: "parse_error", message: "invalid json frame" } });
    return;
  }

  if (typeof req.id !== "string" || typeof req.method !== "string") {
    write(sock, {
      id: typeof req.id === "string" ? req.id : "",
      error: { code: "invalid_request", message: "missing id or method" },
    });
    return;
  }

  try {
    const result = await handle(req.method, req.params);
    write(sock, { id: req.id, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write(sock, { id: req.id, error: { code: "handler_error", message } });
  }
}

function write(sock: Socket, res: RpcResponse): void {
  if (sock.writable) {
    sock.write(`${JSON.stringify(res)}\n`);
  }
}

// -------- client --------

export class IpcClientError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "IpcClientError";
  }
}

export class IpcClient extends EventEmitter {
  private sock: Socket;
  private buf = "";
  private closed = false;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(
    sock: Socket,
    private timeoutMs: number,
  ) {
    super();
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => this.onData(chunk));
    sock.on("error", (err) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      this.closed = true;
      this.emit("error", err);
    });
    sock.on("close", () => {
      this.closed = true;
      this.emit("close");
    });
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new IpcClientError("closed", "client is closed"));
    }
    const id = Math.random().toString(36).slice(2, 12);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new IpcClientError("timeout", `rpc ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      this.sock.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  close(): void {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new IpcClientError("closed", "client closed before response"));
    }
    this.pending.clear();
    this.sock.end();
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let idx = this.buf.indexOf("\n");
    while (idx !== -1) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      idx = this.buf.indexOf("\n");
      if (!line) continue;
      try {
        const res = JSON.parse(line) as RpcResponse;
        const entry = this.pending.get(res.id);
        if (!entry) continue;
        clearTimeout(entry.timer);
        this.pending.delete(res.id);
        if ("error" in res) {
          entry.reject(new IpcClientError(res.error.code, res.error.message));
        } else {
          entry.resolve(res.result);
        }
      } catch (err) {
        logger.debug({ err, line }, "invalid ipc response line");
      }
    }
  }
}

export function connectIpcClient(socketPath: string, timeoutMs = 5_000): Promise<IpcClient> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath);
    sock.once("connect", () => resolve(new IpcClient(sock, timeoutMs)));
    sock.once("error", (err) => reject(err));
  });
}

/**
 * Try to connect. Returns null if the socket doesn't exist or refuses —
 * which is how CLI commands fall back to direct DB access.
 */
export async function tryConnectIpcClient(
  socketPath: string,
  timeoutMs = 2_000,
): Promise<IpcClient | null> {
  try {
    return await connectIpcClient(socketPath, timeoutMs);
  } catch {
    return null;
  }
}

export function defaultSocketPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return `${home}/.brain/sock`;
}

export function defaultPidPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return `${home}/.brain/daemon.pid`;
}

export function defaultLogPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return `${home}/.brain/daemon.log`;
}
