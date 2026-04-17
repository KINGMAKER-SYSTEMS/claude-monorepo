import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { z } from "zod";
import { getEnv } from "./env.js";

const rootSchema = z.object({
  path: z.string(),
  tags: z.array(z.string()).default([]),
  excludes: z.array(z.string()).default([]),
});

const configSchema = z.object({
  roots: z.array(rootSchema).default([]),
  maxDepth: z.number().int().min(1).max(10).default(4),
});

export type BrainConfig = z.infer<typeof configSchema>;
export type BrainRoot = z.infer<typeof rootSchema>;

export function defaultConfigPath(): string {
  const override = getEnv().BRAIN_CONFIG_PATH;
  if (override) return resolve(override);
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "brain", "config.toml");
}

export function loadConfig(path = defaultConfigPath()): BrainConfig {
  if (!existsSync(path)) return configSchema.parse({});
  const raw = readFileSync(path, "utf8");
  const parsed = parseToml(raw);
  return configSchema.parse(parsed);
}

export function saveConfig(config: BrainConfig, path = defaultConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyToml(config satisfies Record<string, unknown>));
}

export const CANDIDATE_ROOTS = [
  "~/code",
  "~/work",
  "~/projects",
  "~/src",
  "~/Developer",
  "~/Documents/GitHub",
];

export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}
