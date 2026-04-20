import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { EmbedderConfig, EmbedderKind } from "./types.js";

/**
 * Read [embedder] section from ~/.config/brain/config.toml.
 * Falls back to OpenAI defaults if unset.
 */
export function loadEmbedderConfig(path?: string): EmbedderConfig {
  const p = path ?? join(homedir(), ".config", "brain", "config.toml");
  if (!existsSync(p)) {
    return { kind: "openai" };
  }
  const raw = readFileSync(p, "utf8");
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(raw) as Record<string, unknown>;
  } catch {
    return { kind: "openai" };
  }
  const section = (doc["embedder"] ?? {}) as Record<string, unknown>;
  const kind = (section["kind"] as EmbedderKind | undefined) ?? "openai";
  const out: EmbedderConfig = { kind };
  if (typeof section["model"] === "string") out.model = section["model"] as string;
  if (typeof section["dim"] === "number") out.dim = section["dim"] as number;
  if (typeof section["endpoint"] === "string") out.endpoint = section["endpoint"] as string;
  if (typeof section["api_key"] === "string") out.apiKey = section["api_key"] as string;
  return out;
}
