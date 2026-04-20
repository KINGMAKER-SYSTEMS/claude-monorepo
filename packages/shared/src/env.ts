import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url().default("postgres://brain:brain@localhost:5433/brain"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  BRAIN_CONFIG_PATH: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}
