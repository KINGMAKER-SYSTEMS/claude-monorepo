import { pino, type Logger, type LoggerOptions } from "pino";

const isTTY = process.stdout.isTTY;

const options: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
};
if (isTTY) {
  options.transport = {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
  };
}

export const logger: Logger = pino(options);

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
