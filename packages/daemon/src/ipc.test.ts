import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { startIpcServer, tryConnectIpcClient, type IpcServer } from "./ipc.js";

const tmpDirs: string[] = [];
function socketDir(): string {
  const d = mkdtempSync(join(tmpdir(), "brain-ipc-test-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("startIpcServer + IpcClient round-trip", () => {
  it("calls handler and returns result", async () => {
    const sock = join(socketDir(), "brain.sock");
    const server = await startIpcServer(sock, async (method, params) => {
      if (method === "echo") return params;
      if (method === "add") {
        const p = params as { a: number; b: number };
        return p.a + p.b;
      }
      throw new Error(`unknown ${method}`);
    });
    try {
      const client = await tryConnectIpcClient(sock);
      expect(client).not.toBeNull();
      const res1 = await client!.call<{ hi: string }>("echo", { hi: "there" });
      expect(res1).toEqual({ hi: "there" });
      const res2 = await client!.call<number>("add", { a: 2, b: 3 });
      expect(res2).toBe(5);
      client!.close();
    } finally {
      await server.close();
    }
  });

  it("surfaces handler errors", async () => {
    const sock = join(socketDir(), "brain.sock");
    const server = await startIpcServer(sock, async () => {
      throw new Error("kapow");
    });
    try {
      const client = await tryConnectIpcClient(sock);
      await expect(client!.call("anything")).rejects.toThrow(/kapow/);
      client!.close();
    } finally {
      await server.close();
    }
  });

  it("rejects a second server on the same live socket", async () => {
    const sock = join(socketDir(), "brain.sock");
    const s1 = await startIpcServer(sock, async () => "ok");
    try {
      await expect(startIpcServer(sock, async () => "ok")).rejects.toThrow(/socket already in use/);
    } finally {
      await s1.close();
    }
  });

  it("tryConnectIpcClient returns null when no server is listening", async () => {
    const sock = join(socketDir(), "missing.sock");
    const client = await tryConnectIpcClient(sock, 50);
    expect(client).toBeNull();
  });

  it("tolerates malformed frames without crashing", async () => {
    const sock = join(socketDir(), "brain.sock");
    let handlerCalls = 0;
    const server: IpcServer = await startIpcServer(sock, async () => {
      handlerCalls++;
      return "ok";
    });
    try {
      // Write junk, then a valid frame on the same connection.
      await new Promise<void>((resolve, reject) => {
        const raw = createConnection(sock);
        raw.once("connect", () => {
          raw.write("this is not json\n");
          raw.write(JSON.stringify({ id: "r1", method: "ping" }) + "\n");
        });
        let buf = "";
        raw.on("data", (chunk) => {
          buf += chunk.toString();
          if (buf.includes("\n")) {
            raw.end();
          }
        });
        raw.on("close", () => resolve());
        raw.on("error", reject);
        setTimeout(() => reject(new Error("timeout")), 2000);
      });
      // Handler should still have been called for the valid frame.
      expect(handlerCalls).toBeGreaterThanOrEqual(1);
    } finally {
      await server.close();
    }
  });
});
