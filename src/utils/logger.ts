/**
 * Lightweight, dependency-free logger.
 *
 * All log output is written to stderr — never stdout — because the MCP
 * stdio transport treats stdout as the protocol channel. Writing logs
 * to stdout would corrupt JSON-RPC frames and break the server.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const envLevel = (process.env.PHPUSTIK_LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
const activeLevel: LogLevel = envLevel in LEVEL_RANK ? envLevel : 'info';

const isStderrTty = process.stderr.isTTY === true;

const paint = (level: LogLevel, message: string): string => {
  if (!isStderrTty) {
    return `[${level.toUpperCase()}] ${message}`;
  }
  const codes: Record<LogLevel, string> = {
    debug: '\u001b[90m',
    info: '\u001b[36m',
    warn: '\u001b[33m',
    error: '\u001b[31m'
  };
  const reset = '\u001b[0m';
  return `${codes[level]}[${level.toUpperCase()}]${reset} ${message}`;
};

const emit = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
  if (LEVEL_RANK[level] < LEVEL_RANK[activeLevel]) {
    return;
  }
  const timestamp = new Date().toISOString();
  const payload = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  const line = `${timestamp} ${paint(level, message)}${payload}`;
  process.stderr.write(`${line}\n`);
};

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    emit('debug', message, meta);
  },
  info(message: string, meta?: Record<string, unknown>): void {
    emit('info', message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    emit('warn', message, meta);
  },
  error(message: string, meta?: Record<string, unknown>): void {
    emit('error', message, meta);
  }
} as const;
