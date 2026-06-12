/**
 * Shared helpers for the Composer tools and the `phpustik_doctor` tool.
 *
 * Centralises the exec wrapper, ANSI stripping, and the
 * "binary missing" / "command failed" → user-friendly response logic
 * so every Composer-related tool produces consistent output.
 */

import { runCommand, ExecError, isCommandNotFound, type ExecResult } from './executor.js';
import { COMPOSER_BIN, COMPOSER_EXEC_TIMEOUT_MS, COMPOSER_MISSING_HINT } from '../constants.js';
import { errorResult, formatUnknown, textResult, type ToolResponse } from './responses.js';
import { logger } from './logger.js';

export const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

export type ComposerRunResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number; durationMs: number }
  | { ok: false; reason: 'missing-binary' };

export const runComposer = async (
  cwd: string,
  args: readonly string[],
  timeoutMs: number = COMPOSER_EXEC_TIMEOUT_MS
): Promise<ComposerRunResult> => {
  try {
    const r: ExecResult = await runCommand(COMPOSER_BIN, args, { cwd, timeoutMs });
    return { ok: true, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: r.durationMs };
  } catch (err) {
    if (isCommandNotFound(err)) {
      logger.warn('composer.missing', { binary: COMPOSER_BIN });
      return { ok: false, reason: 'missing-binary' };
    }
    if (err instanceof ExecError) {
      return {
        ok: true,
        stdout: err.stdout,
        stderr: err.stderr,
        exitCode: err.exitCode,
        durationMs: 0
      };
    }
    throw err;
  }
};

export const composerMissingBinary = (): ToolResponse => {
  logger.warn('composer.missing', { binary: COMPOSER_BIN });
  return errorResult(COMPOSER_MISSING_HINT);
};

export const formatComposerResult = (result: { stdout: string; stderr: string }, fallback: string): string => {
  const clean = stripAnsi(
    result.stderr.trim().length > 0 ? `${result.stdout}\n${result.stderr}` : result.stdout
  ).trim();
  return clean.length > 0 ? clean : fallback;
};

export const formatComposerError = (result: { stdout: string; stderr: string; exitCode: number }, context: string): ToolResponse =>
  errorResult(
    `${context} (exit ${result.exitCode}):\n\n${stripAnsi(
      result.stderr.trim().length > 0 ? `${result.stdout}\n${result.stderr}` : result.stdout
    ).trim()}`
  );

void textResult;
void formatUnknown;
