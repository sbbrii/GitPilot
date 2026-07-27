import * as vscode from "vscode";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private channel: vscode.OutputChannel | undefined;
  private minLevel: LogLevel = process.env["NODE_ENV"] === "production" ? "info" : "debug";

  init(channel: vscode.OutputChannel): void {
    this.channel = channel;
  }

  private write(level: LogLevel, component: string, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${component}]`;
    const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
    const line = `${prefix} ${message}${metaStr}`;

    this.channel?.appendLine(line);
    if (level === "error") {
      console.error(line);
    }
  }

  debug(component: string, message: string, meta?: unknown): void {
    this.write("debug", component, message, meta);
  }

  info(component: string, message: string, meta?: unknown): void {
    this.write("info", component, message, meta);
  }

  warn(component: string, message: string, meta?: unknown): void {
    this.write("warn", component, message, meta);
  }

  error(component: string, message: string, meta?: unknown): void {
    this.write("error", component, message, meta);
  }

  /** Return a scoped logger bound to a component name. */
  scope(component: string) {
    return {
      debug: (msg: string, meta?: unknown) => this.debug(component, msg, meta),
      info: (msg: string, meta?: unknown) => this.info(component, msg, meta),
      warn: (msg: string, meta?: unknown) => this.warn(component, msg, meta),
      error: (msg: string, meta?: unknown) => this.error(component, msg, meta),
    };
  }
}

export const logger = new Logger();
