export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "OFF";

const ANSI_COLORS: Record<string, string> = {
  reset: "\x1b[0m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

/** Wraps text in ANSI color codes. Accepts a named color or a raw ANSI escape code. */
export function colorize(text: string, color: string): string {
  const code = ANSI_COLORS[color] ?? color;
  return `${code}${text}${ANSI_COLORS.reset}`;
}

const LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  OFF: 99,
};

const COLORS: Record<LogLevel, string> = {
  DEBUG: "\x1b[90m",   // gray
  INFO:  "\x1b[36m",   // cyan
  WARN:  "\x1b[33m",   // yellow
  ERROR: "\x1b[31m",   // red
  OFF:   "",
};

const RESET = "\x1b[0m";

function getConfiguredLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? "OFF").toUpperCase() as LogLevel;
  return LEVELS[raw] ?? LEVELS.OFF;
}

export function log(level: LogLevel, namespace: string, message: string, data?: unknown): void {
  if (LEVELS[level] < getConfiguredLevel()) return;

  const color = COLORS[level];
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const prefix = `${color}[${level}][${namespace}]${RESET}`;

  if (data !== undefined) {
    console.log(`${ts} ${prefix} ${message}`, data);
  } else {
    console.log(`${ts} ${prefix} ${message}`);
  }
}

export const logger = {
  debug: (ns: string, msg: string, data?: unknown) => log("DEBUG", ns, msg, data),
  info:  (ns: string, msg: string, data?: unknown) => log("INFO",  ns, msg, data),
  warn:  (ns: string, msg: string, data?: unknown) => log("WARN",  ns, msg, data),
  error: (ns: string, msg: string, data?: unknown) => log("ERROR", ns, msg, data),
};
