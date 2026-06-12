/**
 * Helpers that produce consistent, MCP-compliant tool responses.
 *
 * Every tool returns `{ content, isError?, structuredContent? }`:
 *   - `content`        — human-readable Markdown/text (what the user sees)
 *   - `structuredContent` — typed JSON the model can iterate over without parsing
 *   - `isError`        — protocol-level failure flag
 *
 * The `textResult` / `errorResult` helpers accept a second `structured`
 * argument so every tool can opt-in to machine-readable output.
 */

import { normalisePath, PathError } from './paths.js';
import {
  CommandNotFoundError,
  ExecError,
  isCommandNotFound,
  runCommand
} from './executor.js';
import { logger } from './logger.js';
import { resolveWorkspace, type WorkspaceContext } from './workspace.js';
import { PHP_MISSING_HINT } from '../constants.js';

export interface ToolResponse {
  readonly [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

const buildErrorMessage = (title: string, body: string): string => `${title}\n\n${body}`;

const withHint = (stderr: string, hint: string): string => {
  const trimmed = stderr.trim();
  if (trimmed.length === 0) {
    return hint;
  }
  return `${trimmed}\n\n${hint}`;
};

export const textResult = (text: string, structured?: Record<string, unknown>): ToolResponse => {
  const base: ToolResponse = { content: [{ type: 'text' as const, text }] };
  if (structured) {
    base.structuredContent = structured;
  }
  return base;
};

export const errorResult = (message: string, structured?: Record<string, unknown>): ToolResponse => {
  const base: ToolResponse = { content: [{ type: 'text' as const, text: message }], isError: true };
  if (structured) {
    base.structuredContent = structured;
  }
  return base;
};

export const pathErrorResult = (err: unknown): ToolResponse => {
  if (err instanceof PathError) {
    return errorResult(`Geçersiz dosya yolu: ${err.message}`);
  }
  return errorResult(`Beklenmeyen bir yol hatası oluştu: ${formatUnknown(err)}`);
};

export const formatUnknown = (err: unknown): string => {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
};

export const runWithErrorMapping = async (
  command: string,
  args: readonly string[],
  options: Parameters<typeof runCommand>[2] = {},
  hints: { notFoundHint?: string } = {}
): Promise<ToolResponse> => {
  try {
    const result = await runCommand(command, args, options);
    const payload =
      result.stderr.trim().length > 0
        ? `${result.stdout}\n${result.stderr}`.trim()
        : result.stdout.trim();
    return textResult(
      payload.length > 0
        ? payload
        : `${command} başarıyla çalıştı (exit code 0, ${result.durationMs} ms).`
    );
  } catch (err) {
    if (isCommandNotFound(err)) {
      const missing = err instanceof CommandNotFoundError ? err.command : command;
      const hint = hints.notFoundHint ?? `${missing} bulunamadı. PATH ortam değişkeninizi kontrol edin.`;
      logger.warn('tool.missing_binary', { command: missing });
      return errorResult(hint);
    }
    if (err instanceof ExecError) {
      const lower = err.stderr.toLowerCase();
      if (command === 'php' && /not found|not recognized|enoent/.test(lower)) {
        return errorResult(withHint(err.stderr, PHP_MISSING_HINT));
      }
      logger.warn('tool.exec_failed', {
        command,
        exitCode: err.exitCode
      });
      return errorResult(
        buildErrorMessage(
          `Komut başarısız: ${err.command} (exit ${err.exitCode})`,
          err.stderr.trim().length > 0 ? err.stderr.trim() : err.stdout.trim()
        )
      );
    }
    logger.error('tool.unexpected', { command, error: formatUnknown(err) });
    return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
  }
};

export const safeNormalisePath = (raw: string): { ok: true; path: string } | { ok: false; response: ToolResponse } => {
  try {
    return { ok: true, path: normalisePath(raw) };
  } catch (err) {
    return { ok: false, response: pathErrorResult(err) };
  }
};

export const resolveProjectRoot = (hint?: string): WorkspaceContext => resolveWorkspace(hint);

export const resolveInsideWorkspace = (
  _ws: WorkspaceContext,
  rawPath: string
): { ok: true; path: string } | { ok: false; response: ToolResponse } => {
  const normalised = safeNormalisePath(rawPath);
  if (!normalised.ok) {
    return normalised;
  }
  return { ok: true, path: normalised.path };
};
