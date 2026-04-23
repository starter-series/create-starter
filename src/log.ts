const DEBUG_ENABLED =
  process.env.CREATE_STARTER_DEBUG === "1" ||
  (process.env.DEBUG ?? "").split(",").some((t) => t.trim() === "create-starter");

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

function format(level: string, msg: string, args: unknown[]): string {
  if (args.length === 0) return `[create-starter] ${level}: ${msg}`;
  const rendered = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  return `[create-starter] ${level}: ${msg} ${rendered}`;
}

export const stderrLogger: Logger = {
  debug(msg, ...args) {
    if (DEBUG_ENABLED) process.stderr.write(format("debug", msg, args) + "\n");
  },
  info(msg, ...args) {
    process.stderr.write(format("info", msg, args) + "\n");
  },
  warn(msg, ...args) {
    process.stderr.write(format("warn", msg, args) + "\n");
  },
  error(msg, ...args) {
    process.stderr.write(format("error", msg, args) + "\n");
  },
};

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
