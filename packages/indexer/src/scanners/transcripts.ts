import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join } from "node:path";

export interface TranscriptSession {
  device: string;
  sessionUuid: string;
  sourcePath: string;
  cwd: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  messageCount: number;
  userMessageCount: number;
  toolUseCount: number;
  firstUserMessage: string | null;
  lastUserMessage: string | null;
  contentHash: string;
}

export interface TranscriptScanOptions {
  root?: string;
  device?: string;
  /** Skip files whose mtime is older than this ISO date. Defaults to 90d ago. */
  since?: Date;
}

/**
 * Scan Claude Code session transcripts from disk.
 *
 * Layout (per device):
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *
 * Each line is a JSON object; common types include user, assistant, system,
 * summary, file-history-snapshot. We extract lightweight session metadata only.
 */
export function scanTranscripts(opts: TranscriptScanOptions = {}): TranscriptSession[] {
  const device = opts.device ?? hostname();
  const root = opts.root ?? join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return [];

  const cutoff = opts.since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const sessions: TranscriptSession[] = [];

  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }

  for (const encoded of dirs) {
    const dir = join(root, encoded);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const full = join(dir, file);
      let fst;
      try {
        fst = statSync(full);
      } catch {
        continue;
      }
      if (fst.mtime < cutoff) continue;

      const session = parseSessionFile(full, device, encoded);
      if (session) sessions.push(session);
    }
  }

  return sessions;
}

function parseSessionFile(
  path: string,
  device: string,
  encodedDir: string,
): TranscriptSession | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  if (!raw.trim()) return null;

  const sessionUuid = basename(path).replace(/\.jsonl$/, "");
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);

  let messageCount = 0;
  let userMessageCount = 0;
  let toolUseCount = 0;
  let startedAt: Date | null = null;
  let endedAt: Date | null = null;
  let firstUserMessage: string | null = null;
  let lastUserMessage: string | null = null;
  let cwd: string | null = null;

  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (typeof obj.cwd === "string" && !cwd) cwd = obj.cwd;

    const ts = typeof obj.timestamp === "string" ? new Date(obj.timestamp) : null;
    if (ts && !Number.isNaN(ts.getTime())) {
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (!endedAt || ts > endedAt) endedAt = ts;
    }

    const type = typeof obj.type === "string" ? obj.type : null;
    if (type === "user" || type === "assistant" || type === "system") {
      messageCount++;
    }

    if (type === "user") {
      const text = extractUserText(obj);
      if (text) {
        userMessageCount++;
        if (!firstUserMessage) firstUserMessage = text;
        lastUserMessage = text;
      }
    }

    if (type === "assistant") {
      const msg = obj.message as { content?: unknown } | undefined;
      if (msg && Array.isArray(msg.content)) {
        for (const block of msg.content as Array<Record<string, unknown>>) {
          if (block && block.type === "tool_use") toolUseCount++;
        }
      }
    }
  }

  if (!cwd) cwd = decodeCwd(encodedDir);

  return {
    device,
    sessionUuid,
    sourcePath: path,
    cwd,
    startedAt,
    endedAt,
    messageCount,
    userMessageCount,
    toolUseCount,
    firstUserMessage: truncate(firstUserMessage, 500),
    lastUserMessage: truncate(lastUserMessage, 500),
    contentHash: hash,
  };
}

function extractUserText(obj: Record<string, unknown>): string | null {
  const msg = obj.message as { content?: unknown; role?: string } | undefined;
  if (!msg) return null;
  const content = msg.content;
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block && block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    const joined = parts.join("\n").trim();
    return joined || null;
  }
  return null;
}

function decodeCwd(encoded: string): string | null {
  // Claude Code encodes cwd by replacing / with - and prefixing. Best effort.
  if (!encoded.startsWith("-")) return null;
  return "/" + encoded.slice(1).replace(/-/g, "/");
}

function truncate(s: string | null, max: number): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * Extract candidate "open loop" phrases from a user message.
 * Heuristic regex; noisy but useful.
 */
export function extractOpenLoops(text: string): string[] {
  if (!text) return [];
  const loops: string[] = [];
  const rx =
    /\b(?:tomorrow|later|next time|next session|eventually|remind me|don['’]t forget|we should|we need to|todo|i['’]ll|i will|after (?:this|that)|once (?:this|that) (?:is )?done)\b[^.!?\n]{3,160}[.!?]?/gi;
  for (const m of text.matchAll(rx)) {
    const phrase = m[0].trim();
    if (phrase.length > 10) loops.push(phrase);
  }
  return loops;
}
