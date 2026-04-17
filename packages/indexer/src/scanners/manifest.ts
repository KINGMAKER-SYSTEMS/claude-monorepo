import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ManifestSource } from "@brain/shared";

export interface DependencyRecord {
  source: ManifestSource;
  name: string;
  version: string | null;
  isDev: boolean;
}

export interface ManifestSnapshot {
  primaryLang: string | null;
  dependencies: DependencyRecord[];
}

export function scanManifests(rootPath: string): ManifestSnapshot {
  const deps: DependencyRecord[] = [];
  const langs = new Set<string>();

  const pkgJson = join(rootPath, "package.json");
  if (existsSync(pkgJson)) {
    langs.add("typescript/javascript");
    try {
      const parsed = JSON.parse(readFileSync(pkgJson, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      for (const [name, version] of Object.entries(parsed.dependencies ?? {})) {
        deps.push({ source: "package_json", name, version, isDev: false });
      }
      for (const [name, version] of Object.entries(parsed.devDependencies ?? {})) {
        deps.push({ source: "package_json", name, version, isDev: true });
      }
    } catch {
      // skip malformed package.json
    }
  }

  const cargo = join(rootPath, "Cargo.toml");
  if (existsSync(cargo)) {
    langs.add("rust");
    deps.push(...parseCargoToml(readFileSync(cargo, "utf8")));
  }

  const goMod = join(rootPath, "go.mod");
  if (existsSync(goMod)) {
    langs.add("go");
    deps.push(...parseGoMod(readFileSync(goMod, "utf8")));
  }

  const pyProject = join(rootPath, "pyproject.toml");
  if (existsSync(pyProject)) {
    langs.add("python");
    deps.push(...parsePyproject(readFileSync(pyProject, "utf8")));
  }

  const reqs = join(rootPath, "requirements.txt");
  if (existsSync(reqs)) {
    langs.add("python");
    for (const line of readFileSync(reqs, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [name, version] = trimmed.split(/[=<>~!]+/, 2);
      if (name) deps.push({ source: "requirements_txt", name: name.trim(), version: version?.trim() ?? null, isDev: false });
    }
  }

  const gemfile = join(rootPath, "Gemfile");
  if (existsSync(gemfile)) {
    langs.add("ruby");
    for (const line of readFileSync(gemfile, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
      if (match) deps.push({ source: "gemfile", name: match[1]!, version: match[2] ?? null, isDev: false });
    }
  }

  const primaryLang = langs.size === 1 ? [...langs][0]! : langs.size > 1 ? "mixed" : null;
  return { primaryLang, dependencies: deps };
}

function parseCargoToml(body: string): DependencyRecord[] {
  const deps: DependencyRecord[] = [];
  let section: "deps" | "dev" | "other" = "other";
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      if (line === "[dependencies]") section = "deps";
      else if (line === "[dev-dependencies]") section = "dev";
      else section = "other";
      continue;
    }
    if (section === "other" || !line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const name = match[1]!;
    const rhs = match[2]!.trim();
    let version: string | null = null;
    const stringMatch = rhs.match(/^"([^"]+)"$/);
    if (stringMatch) version = stringMatch[1]!;
    else {
      const inlineVersion = rhs.match(/version\s*=\s*"([^"]+)"/);
      if (inlineVersion) version = inlineVersion[1]!;
    }
    deps.push({ source: "cargo_toml", name, version, isDev: section === "dev" });
  }
  return deps;
}

function parseGoMod(body: string): DependencyRecord[] {
  const deps: DependencyRecord[] = [];
  let inRequireBlock = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("require (")) {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ")") {
      inRequireBlock = false;
      continue;
    }
    const required = line.startsWith("require ") ? line.slice("require ".length).trim() : inRequireBlock ? line : null;
    if (!required || required.startsWith("//")) continue;
    const parts = required.split(/\s+/);
    if (parts.length >= 2) deps.push({ source: "go_mod", name: parts[0]!, version: parts[1] ?? null, isDev: false });
  }
  return deps;
}

function parsePyproject(body: string): DependencyRecord[] {
  const deps: DependencyRecord[] = [];
  const lines = body.split(/\r?\n/);
  let section = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      section = line;
      continue;
    }
    // PEP 621 style: [project] dependencies = [...]
    if (section === "[project]" && line.startsWith("dependencies")) {
      const arrayMatch = body.match(/dependencies\s*=\s*\[([^\]]*)\]/s);
      if (arrayMatch) {
        for (const item of arrayMatch[1]!.split(",")) {
          const s = item.trim().replace(/^["']|["']$/g, "");
          if (!s) continue;
          const [name, version] = s.split(/[=<>~!]+/, 2);
          if (name) deps.push({ source: "pyproject_toml", name: name.trim(), version: version?.trim() ?? null, isDev: false });
        }
      }
    }
    // Poetry style: [tool.poetry.dependencies] foo = "^1.2"
    if (section === "[tool.poetry.dependencies]" || section === "[tool.poetry.dev-dependencies]") {
      const isDev = section.includes("dev-dependencies");
      const match = line.match(/^([a-zA-Z0-9_.-]+)\s*=\s*"([^"]+)"/);
      if (match && match[1] !== "python") {
        deps.push({ source: "pyproject_toml", name: match[1]!, version: match[2]!, isDev });
      }
    }
  }
  return deps;
}
