/**
 * Safe, observable wrapper around `child_process.execFile` for shelling
 * out to PHP, PHPStan and PHP-CS-Fixer.
 *
 * Design goals:
 *  - No `shell: true`. We use `execFile` so arguments cannot be parsed as
 *    a shell command, eliminating an entire class of injection bugs.
 *  - Deterministic timeouts so a hanging `phpstan analyse` cannot block
 *    the MCP event loop forever.
 *  - All failures are normalised into `ExecError` so tool handlers can
 *    produce stable, structured error responses.
 *  - stderr/stdout are capped to prevent OOM on a runaway tool.
 *  - Every long-running call is registered in the active-ops registry
 *    so the server's cancellation handler can kill it on demand.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger.js';
import { wrapWithRegistration } from './active-ops.js';

const execFileAsync = promisify(execFile);

export const MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB per stream

export interface ExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: string;
  readonly signal?: AbortSignal;
  readonly label?: string;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly command: string;
  readonly args: readonly string[];
  readonly durationMs: number;
  readonly truncated: {
    readonly stdout: boolean;
    readonly stderr: boolean;
  };
}

export class ExecError extends Error {
  public override readonly name = 'ExecError';
  public readonly exitCode: number;
  public readonly stdout: string;
  public readonly stderr: string;
  public readonly command: string;
  public readonly args: readonly string[];

  public constructor(params: {
    message: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    command: string;
    args: readonly string[];
  }) {
    super(params.message);
    this.exitCode = params.exitCode;
    this.stdout = params.stdout;
    this.stderr = params.stderr;
    this.command = params.command;
    this.args = params.args;
  }
}

export class CommandNotFoundError extends Error {
  public override readonly name = 'CommandNotFoundError';
  public readonly command: string;

  public constructor(command: string) {
    super(`Komut bulunamadı: ${command}`);
    this.command = command;
  }
}

export class AbortedError extends Error {
  public override readonly name = 'AbortedError';
  public constructor(reason: string = 'aborted') {
    super(reason);
  }
}

const truncate = (text: string, limit: number): { value: string; truncated: boolean } => {
  if (Buffer.byteLength(text, 'utf8') <= limit) {
    return { value: text, truncated: false };
  }
  const head = Buffer.from(text, 'utf8').subarray(0, limit).toString('utf8');
  return {
    value: `${head}\n\n... [output truncated to ${limit} bytes] ...`,
    truncated: true
  };
};

const isMissingBinary = (err: unknown, command: string): boolean => {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  if (code === 'ENOENT') {
    return true;
  }
  const message = (err as { message?: unknown }).message;
  if (typeof message === 'string') {
    if (message.includes('ENOENT')) {
      return true;
    }
    if (/not found|not recognized/i.test(message) && message.includes(command)) {
      return true;
    }
  }
  return false;
};

const buildCommandLabel = (command: string, args: readonly string[]): string => {
  if (args.length === 0) {
    return command;
  }
  const safeArgs = args.map((arg) => (/[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg));
  return `${command} ${safeArgs.join(' ')}`;
};

const isAbort = (err: unknown): err is Error & { name: string; code?: string } => {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as { name?: string; code?: string; signal?: string };
  if (e.name === 'AbortError') {
    return true;
  }
  if (e.code === 'ABORT_ERR') {
    return true;
  }
  return false;
};

export const runCommand = async (
  command: string,
  args: readonly string[],
  options: ExecOptions = {}
): Promise<ExecResult> => {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const label = options.label ?? buildCommandLabel(command, args);

  return wrapWithRegistration(label, options.signal, async (signal) => {
    const startedAt = Date.now();
    logger.debug('exec.start', { command, args, timeoutMs, cwd: options.cwd });

    if (signal.aborted) {
      throw new AbortedError(String(signal.reason ?? 'aborted'));
    }

    try {
      const result = await execFileAsync(command, [...args], {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        signal
      });

      const stdoutCap = truncate(result.stdout ?? '', MAX_OUTPUT_BYTES);
      const stderrCap = truncate(result.stderr ?? '', MAX_OUTPUT_BYTES);
      const durationMs = Date.now() - startedAt;

      logger.debug('exec.ok', { command, durationMs, exitCode: 0 });
      return {
        stdout: stdoutCap.value,
        stderr: stderrCap.value,
        exitCode: 0,
        command,
        args,
        durationMs,
        truncated: { stdout: stdoutCap.truncated, stderr: stderrCap.truncated }
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;

      if (isAbort(err) || signal.aborted) {
        logger.warn('exec.aborted', { command, durationMs });
        const errMsg = err instanceof Error ? err.message : 'aborted';
        throw new AbortedError(String(signal.reason ?? errMsg));
      }

      if (isMissingBinary(err, command)) {
        logger.warn('exec.missing', { command });
        throw new CommandNotFoundError(command);
      }

      const e = err as {
        code?: string | number;
        stdout?: string;
        stderr?: string;
        message?: string;
        killed?: boolean;
      };
      const exitCode = typeof e.code === 'number' ? e.code : 1;
      const stdoutCap = truncate(e.stdout ?? '', MAX_OUTPUT_BYTES);
      const stderrCap = truncate(e.stderr ?? e.message ?? '', MAX_OUTPUT_BYTES);

      logger.debug('exec.fail', { command, exitCode, durationMs, killed: e.killed ?? false });

      throw new ExecError({
        message:
          e.killed === true
            ? `${label} komutu ${timeoutMs} ms içinde tamamlanamadı ve sonlandırıldı.`
            : `${label} komutu ${exitCode} koduyla başarısız oldu.`,
        exitCode,
        stdout: stdoutCap.value,
        stderr: stderrCap.value,
        command,
        args
      });
    }
  });
};

export const isCommandNotFound = (err: unknown): err is CommandNotFoundError =>
  err instanceof CommandNotFoundError ||
  (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'CommandNotFoundError');

export const isAborted = (err: unknown): err is AbortedError =>
  err instanceof AbortedError ||
  (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortedError');
