import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sep } from "node:path";
import { childLogger } from "@brain/shared";

const execFileP = promisify(execFile);

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  labels: Record<string, string>;
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
}

export interface DevServer {
  pid: number;
  command: string;
  port: number;
  cwd?: string;
  framework?: string;
}

export interface InfraSnapshot {
  containers: DockerContainer[];
  devServers: DevServer[];
  errors: string[];
}

/**
 * Gather a snapshot of local infra: docker containers + listening dev servers.
 * Swallow all subprocess errors — a missing `docker` or `lsof` should not
 * crash the daemon tick, just skip that source.
 */
export async function scanLocalInfra(): Promise<InfraSnapshot> {
  const log = childLogger({ scanner: "infra" });
  const errors: string[] = [];
  const [containers, devServers] = await Promise.all([
    scanDocker().catch((err) => {
      log.debug({ err: err.message }, "docker scan skipped");
      errors.push(`docker: ${err.message}`);
      return [] as DockerContainer[];
    }),
    scanDevServers().catch((err) => {
      log.debug({ err: err.message }, "dev-server scan skipped");
      errors.push(`lsof: ${err.message}`);
      return [] as DevServer[];
    }),
  ]);
  return { containers, devServers, errors };
}

// ---------- docker ----------

async function scanDocker(): Promise<DockerContainer[]> {
  // `docker ps --format '{{json .}}'` emits one JSON object per line.
  const { stdout } = await execFileP("docker", ["ps", "--format", "{{json .}}"], {
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseDockerPsOutput(stdout);
}

export function parseDockerPsOutput(stdout: string): DockerContainer[] {
  const out: DockerContainer[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, string>;
      const labels = parseLabels(row["Labels"] ?? "");
      const composeProject = labels["com.docker.compose.project"];
      const composeService = labels["com.docker.compose.service"];
      const composeWorkingDir = labels["com.docker.compose.project.working_dir"];
      out.push({
        id: row["ID"] ?? "",
        name: row["Names"] ?? "",
        image: row["Image"] ?? "",
        status: row["Status"] ?? "",
        state: row["State"] ?? inferState(row["Status"] ?? ""),
        ports: row["Ports"] ?? "",
        labels,
        ...(composeProject !== undefined && { composeProject }),
        ...(composeService !== undefined && { composeService }),
        ...(composeWorkingDir !== undefined && { composeWorkingDir }),
      });
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

function parseLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!raw) return labels;
  // docker emits labels as comma-separated key=value pairs. Values may
  // contain equals signs but not commas (quoted values aren't produced by
  // --format JSON).
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) labels[k] = v;
  }
  return labels;
}

function inferState(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith("up")) return "running";
  if (s.startsWith("exited")) return "exited";
  if (s.startsWith("paused")) return "paused";
  if (s.startsWith("restarting")) return "restarting";
  return "unknown";
}

// ---------- dev servers ----------

async function scanDevServers(): Promise<DevServer[]> {
  // `lsof -iTCP -sTCP:LISTEN -P -n -F pcPn` emits one record per process/port
  // in a compact "field-prefix" format: lines starting with `p` (pid), `c`
  // (command), `P` (protocol), `n` (name/endpoint).
  const { stdout } = await execFileP(
    "lsof",
    ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcPn"],
    { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const servers = parseLsofOutput(stdout);

  // Enrich with cwd per pid. `lsof -a -p <pid> -d cwd -F n` returns the cwd.
  const byPid = new Map<number, DevServer>();
  for (const s of servers) byPid.set(s.pid, s);
  const pids = [...byPid.keys()];
  await Promise.all(
    pids.map(async (pid) => {
      try {
        const { stdout } = await execFileP(
          "lsof",
          ["-a", "-p", String(pid), "-d", "cwd", "-F", "n"],
          { timeout: 2_000 },
        );
        const cwdLine = stdout.split("\n").find((l) => l.startsWith("n"));
        if (cwdLine) {
          const server = byPid.get(pid);
          if (server) server.cwd = cwdLine.slice(1);
        }
      } catch {
        /* cwd lookup is best-effort */
      }
    }),
  );

  // Infer framework from command.
  for (const s of byPid.values()) {
    const fw = guessFramework(s.command);
    if (fw) s.framework = fw;
  }

  return [...byPid.values()];
}

export function parseLsofOutput(stdout: string): DevServer[] {
  const out: DevServer[] = [];
  let currentPid: number | null = null;
  let currentCommand = "";
  // One pid may listen on multiple ports — each `n` line is a separate row.
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const prefix = line[0];
    const rest = line.slice(1);
    switch (prefix) {
      case "p": {
        const pid = Number(rest);
        if (Number.isFinite(pid)) currentPid = pid;
        break;
      }
      case "c":
        currentCommand = rest;
        break;
      case "n": {
        if (currentPid == null) break;
        // lsof `n` entries look like `*:3000` or `127.0.0.1:3000` or
        // `[::1]:3000`. We only care about the port.
        const colon = rest.lastIndexOf(":");
        if (colon === -1) break;
        const port = Number(rest.slice(colon + 1));
        if (!Number.isFinite(port)) break;
        // Filter to "interesting" ports — skip ephemeral kernel ports.
        if (port < 1024 || port > 65535) break;
        if (!isLikelyDevServer(currentCommand, port)) break;
        out.push({ pid: currentPid, command: currentCommand, port });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

// Heuristic: focus on things that look like dev servers. Drops system daemons
// (sshd, mDNSResponder), databases (postgres, redis — those come via docker),
// and so on. Conservative — if a command name smells like a dev tool OR the
// port is in a common dev range, keep it.
const DEV_COMMANDS = /^(node|bun|deno|next|vite|tsx|webpack|rollup|esbuild|ruby|rails|puma|python|python3|uvicorn|gunicorn|flask|php|caddy|http-server|serve|parcel|astro|nuxt|remix|rsbuild|turbopack)/i;
const SKIP_COMMANDS = /^(sshd|mDNSResponder|launchd|rapportd|ControlCe|AirPlayXP|ScreenConti|postgres|redis-server|mysqld|mongod|cupsd)/i;

function isLikelyDevServer(command: string, port: number): boolean {
  if (SKIP_COMMANDS.test(command)) return false;
  if (DEV_COMMANDS.test(command)) return true;
  // Allow explicit "dev server" port ranges even for unknown commands.
  if (port >= 3000 && port <= 9999) return true;
  return false;
}

export function guessFramework(command: string): string | undefined {
  const c = command.toLowerCase();
  if (c.includes("next")) return "next";
  if (c.includes("vite")) return "vite";
  if (c.includes("remix")) return "remix";
  if (c.includes("nuxt")) return "nuxt";
  if (c.includes("astro")) return "astro";
  if (c.includes("rails") || c.includes("puma")) return "rails";
  if (c.includes("django") || c.includes("gunicorn") || c.includes("uvicorn")) return "django";
  if (c.includes("flask")) return "flask";
  if (c.includes("express") || c.includes("node")) return "node";
  if (c.includes("bun")) return "bun";
  return undefined;
}

/** Map a cwd string to a project root path by longest-prefix match. */
export function assignDevServerToProject(
  cwd: string | undefined,
  projects: { id: string; rootPath: string }[],
): string | null {
  if (!cwd) return null;
  let best: string | null = null;
  let bestLen = -1;
  const candidate = cwd.endsWith(sep) ? cwd : cwd + sep;
  for (const p of projects) {
    const root = p.rootPath.endsWith(sep) ? p.rootPath : p.rootPath + sep;
    if (candidate.startsWith(root) && root.length > bestLen) {
      best = p.id;
      bestLen = root.length;
    }
  }
  return best;
}

/** Map a container (via compose working-dir label) to a project. */
export function assignContainerToProject(
  container: DockerContainer,
  projects: { id: string; rootPath: string }[],
): string | null {
  const hint = container.composeWorkingDir;
  if (!hint) return null;
  return assignDevServerToProject(hint, projects);
}
