import { readdirSync, statSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { expandHome, type DetectedProject, type ProjectKind } from "@brain/shared";

const MANIFEST_MARKERS: Array<{ file: string; kind: ProjectKind }> = [
  { file: "package.json", kind: "node" },
  { file: "Cargo.toml", kind: "rust" },
  { file: "go.mod", kind: "go" },
  { file: "pyproject.toml", kind: "python" },
  { file: "requirements.txt", kind: "python" },
  { file: "Gemfile", kind: "ruby" },
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  ".cache",
  "vendor",
  ".idea",
  ".vscode",
]);

export interface DiscoveryOptions {
  maxDepth?: number;
  skipDirs?: Set<string>;
}

export function discoverProjects(root: string, opts: DiscoveryOptions = {}): DetectedProject[] {
  const maxDepth = opts.maxDepth ?? 4;
  const skip = opts.skipDirs ?? SKIP_DIRS;
  const expanded = expandHome(root);
  if (!existsSync(expanded)) return [];

  const found: DetectedProject[] = [];
  walk(expanded, 0, maxDepth, skip, found);
  return found;
}

function walk(
  dir: string,
  depth: number,
  maxDepth: number,
  skip: Set<string>,
  acc: DetectedProject[],
): void {
  if (depth > maxDepth) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  const detected = detectProject(dir, entries);
  if (detected) {
    acc.push(detected);
    // Don't recurse into a detected project — treat it as a leaf.
    return;
  }

  for (const entry of entries) {
    if (skip.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, depth + 1, maxDepth, skip, acc);
  }
}

function detectProject(dir: string, entries: string[]): DetectedProject | null {
  const hasGit = entries.includes(".git");
  const matches = MANIFEST_MARKERS.filter((m) => entries.includes(m.file));

  if (!hasGit && matches.length === 0) return null;

  const kind: ProjectKind =
    matches.length === 0 ? "unknown" : matches.length > 1 ? "mixed" : (matches[0]?.kind ?? "unknown");

  return {
    rootPath: dir,
    name: basename(dir),
    kind,
    hasGit,
  };
}
