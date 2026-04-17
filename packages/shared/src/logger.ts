import { pino, type Logger } from "pino";

const isTTY = process.stdout.isTTY;

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: isTTY
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
      }
    : undefined,
});

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
