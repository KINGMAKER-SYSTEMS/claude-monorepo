import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface ProjectContext {
  summary: string | null;
  readmeFirstPara: string | null;
  framework: string | null;
  todoCount: number;
  todos: Array<{ file: string; line: number; text: string }>;
  serviceTokens: string[];
  deployTargets: string[];
  envKeys: string[];
}

/**
 * Heuristic, filesystem-only project context extraction.
 * Cheap enough to run on every scan; no network or LLM calls.
 */
export function scanProjectContext(rootPath: string): ProjectContext {
  const readmeFirstPara = readReadmeFirstParagraph(rootPath);
  const pkgDescription = readPackageDescription(rootPath);
  const summary = pkgDescription ?? readmeFirstPara;

  const framework = detectFramework(rootPath);
  const deployTargets = detectDeployTargets(rootPath);
  const { serviceTokens, envKeys } = detectServices(rootPath);
  const todos = collectTodos(rootPath);

  return {
    summary,
    readmeFirstPara,
    framework,
    todoCount: todos.length,
    todos,
    serviceTokens,
    deployTargets,
    envKeys,
  };
}

function readReadmeFirstParagraph(rootPath: string): string | null {
  const candidates = ["README.md", "README.MD", "readme.md", "Readme.md", "README"];
  for (const name of candidates) {
    const p = join(rootPath, name);
    if (!existsSync(p)) continue;
    try {
      const body = readFileSync(p, "utf8");
      const lines = body.split(/\r?\n/);
      const paragraph: string[] = [];
      let hitProse = false;
      for (const raw of lines) {
        const line = raw.trim();
        if (!hitProse) {
          if (!line || line.startsWith("#") || line.startsWith("!") || line.startsWith("[!") || line.startsWith("---")) continue;
          hitProse = true;
          paragraph.push(line);
          continue;
        }
        if (!line) break;
        paragraph.push(line);
      }
      const joined = paragraph.join(" ").replace(/\s+/g, " ").trim();
      if (joined) return joined.slice(0, 400);
    } catch {
      // ignore
    }
  }
  return null;
}

function readPackageDescription(rootPath: string): string | null {
  const pkg = join(rootPath, "package.json");
  if (!existsSync(pkg)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { description?: string };
    return parsed.description?.trim() || null;
  } catch {
    return null;
  }
}

const FRAMEWORK_DEP_MAP: Array<{ dep: string; framework: string }> = [
  { dep: "next", framework: "next.js" },
  { dep: "nuxt", framework: "nuxt" },
  { dep: "@remix-run/react", framework: "remix" },
  { dep: "@remix-run/node", framework: "remix" },
  { dep: "astro", framework: "astro" },
  { dep: "vite", framework: "vite" },
  { dep: "expo", framework: "expo" },
  { dep: "@sveltejs/kit", framework: "sveltekit" },
  { dep: "@angular/core", framework: "angular" },
  { dep: "gatsby", framework: "gatsby" },
  { dep: "fastify", framework: "fastify" },
  { dep: "express", framework: "express" },
  { dep: "hono", framework: "hono" },
  { dep: "@nestjs/core", framework: "nest.js" },
  { dep: "electron", framework: "electron" },
  { dep: "tauri", framework: "tauri" },
  { dep: "react-native", framework: "react-native" },
];

function detectFramework(rootPath: string): string | null {
  const pkg = join(rootPath, "package.json");
  if (existsSync(pkg)) {
    try {
      const parsed = JSON.parse(readFileSync(pkg, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const all = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
      for (const { dep, framework } of FRAMEWORK_DEP_MAP) {
        if (dep in all) return framework;
      }
    } catch {
      // ignore
    }
  }
  if (existsSync(join(rootPath, "pyproject.toml"))) {
    const body = safeRead(join(rootPath, "pyproject.toml"));
    if (body && /fastapi/i.test(body)) return "fastapi";
    if (body && /django/i.test(body)) return "django";
    if (body && /flask/i.test(body)) return "flask";
  }
  if (existsSync(join(rootPath, "Cargo.toml"))) {
    const body = safeRead(join(rootPath, "Cargo.toml"));
    if (body && /axum/i.test(body)) return "axum";
    if (body && /actix-web/i.test(body)) return "actix";
    if (body && /tauri/i.test(body)) return "tauri";
  }
  return null;
}

function detectDeployTargets(rootPath: string): string[] {
  const targets = new Set<string>();
  if (existsSync(join(rootPath, "vercel.json")) || existsSync(join(rootPath, ".vercel"))) targets.add("vercel");
  if (existsSync(join(rootPath, "railway.toml")) || existsSync(join(rootPath, "railway.json"))) targets.add("railway");
  if (existsSync(join(rootPath, "fly.toml"))) targets.add("fly.io");
  if (existsSync(join(rootPath, "netlify.toml"))) targets.add("netlify");
  if (existsSync(join(rootPath, "wrangler.toml")) || existsSync(join(rootPath, "wrangler.jsonc"))) targets.add("cloudflare");
  if (existsSync(join(rootPath, "render.yaml"))) targets.add("render");
  if (existsSync(join(rootPath, "app.yaml"))) targets.add("gcp-app-engine");
  if (existsSync(join(rootPath, "Dockerfile")) || existsSync(join(rootPath, "Containerfile"))) targets.add("docker");
  return [...targets].sort();
}

function detectServices(rootPath: string): { serviceTokens: string[]; envKeys: string[] } {
  const services = new Set<string>();
  const envKeys = new Set<string>();

  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    const body = safeRead(join(rootPath, name));
    if (!body) continue;
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^\s{2}([a-zA-Z0-9_.-]+):\s*$/);
      if (m && m[1] && !["version", "services", "networks", "volumes"].includes(m[1])) {
        services.add(m[1]);
      }
      const img = line.match(/^\s*image:\s*([^\s]+)/);
      if (img && img[1]) {
        const base = img[1].split("/").pop()?.split(":")[0];
        if (base) services.add(base);
      }
    }
  }

  for (const name of [".env.example", ".env.sample", ".env.template"]) {
    const body = safeRead(join(rootPath, name));
    if (!body) continue;
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Z0-9_]+)=/);
      if (m && m[1]) {
        envKeys.add(m[1]);
        const token = inferServiceFromEnv(m[1]);
        if (token) services.add(token);
      }
    }
  }

  return { serviceTokens: [...services].sort(), envKeys: [...envKeys].sort() };
}

function inferServiceFromEnv(key: string): string | null {
  const map: Array<[RegExp, string]> = [
    [/^STRIPE_/, "stripe"],
    [/^OPENAI_/, "openai"],
    [/^ANTHROPIC_/, "anthropic"],
    [/^SUPABASE_/, "supabase"],
    [/^CLERK_/, "clerk"],
    [/^AUTH0_/, "auth0"],
    [/^RESEND_/, "resend"],
    [/^POSTGRES_|^PG_|^DATABASE_URL/, "postgres"],
    [/^REDIS_/, "redis"],
    [/^AWS_/, "aws"],
    [/^GCP_|^GOOGLE_/, "gcp"],
    [/^SENDGRID_/, "sendgrid"],
    [/^TWILIO_/, "twilio"],
    [/^LINEAR_/, "linear"],
    [/^NOTION_/, "notion"],
    [/^SLACK_/, "slack"],
    [/^GITHUB_/, "github"],
    [/^VERCEL_/, "vercel"],
    [/^RAILWAY_/, "railway"],
    [/^FLY_/, "fly.io"],
    [/^CLOUDFLARE_/, "cloudflare"],
    [/^DISCORD_/, "discord"],
  ];
  for (const [rx, tok] of map) if (rx.test(key)) return tok;
  return null;
}

const TODO_RX = /\b(TODO|FIXME|HACK|XXX)\b[:\s]?(.*)$/;
const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".rb", ".java", ".kt", ".swift",
  ".vue", ".svelte", ".astro", ".md",
]);
const SKIP_DIR = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo",
  "target", ".venv", "venv", "__pycache__", ".cache", "vendor",
  ".idea", ".vscode", "coverage",
]);

function collectTodos(rootPath: string, maxFiles = 300, maxTotal = 200): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  let files = 0;
  const stack: string[] = [rootPath];
  while (stack.length && out.length < maxTotal && files < maxFiles) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIR.has(entry) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      const dot = entry.lastIndexOf(".");
      const ext = dot >= 0 ? entry.slice(dot) : "";
      if (!SOURCE_EXT.has(ext)) continue;
      if (st.size > 256 * 1024) continue;
      files++;
      let body: string;
      try {
        body = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const rel = relative(rootPath, full);
      const lines = body.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(TODO_RX);
        if (!m) continue;
        const text = (m[2] ?? "").trim().slice(0, 200);
        out.push({ file: rel, line: i + 1, text: `${m[1]}${text ? ": " + text : ""}` });
        if (out.length >= maxTotal) break;
      }
    }
  }
  return out;
}

function safeRead(p: string): string | null {
  try {
    if (!existsSync(p)) return null;
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
