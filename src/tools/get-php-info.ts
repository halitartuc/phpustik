/**
 * `get_php_info` — Report the active PHP runtime and loaded extensions.
 *
 * Combines `php -v` and `php -m` into a single response so the model gets
 * the full picture (version, build, SAPI, modules) with one tool call.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { DEFAULT_EXEC_TIMEOUT_MS, PHP_MISSING_HINT } from '../constants.js';
import { runWithErrorMapping, textResult } from '../utils/responses.js';
import { ExecError, isCommandNotFound } from '../utils/executor.js';
import { logger } from '../utils/logger.js';

export const GET_PHP_INFO_TOOL = 'get_php_info';

export const registerGetPhpInfoTool = (server: McpServer): void => {
  server.registerTool(
    GET_PHP_INFO_TOOL,
    {
      title: 'PHP Environment Info',
      description:
        "Sistemdeki aktif PHP sürümünü, derleme bilgilerini, SAPI türünü ve yüklü modülleri döndürür. PHP kurulumunu doğrulamak için kullanılır.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      logger.debug('tool.call', { tool: GET_PHP_INFO_TOOL });

      const versionResult = await runWithErrorMapping(
        'php',
        ['-v'],
        { timeoutMs: DEFAULT_EXEC_TIMEOUT_MS },
        { notFoundHint: PHP_MISSING_HINT }
      );

      if (versionResult.isError) {
        return versionResult;
      }

      const modulesResult = await runWithErrorMapping(
        'php',
        ['-m'],
        { timeoutMs: DEFAULT_EXEC_TIMEOUT_MS },
        { notFoundHint: PHP_MISSING_HINT }
      );

      if (modulesResult.isError) {
        return modulesResult;
      }

      const versionText = versionResult.content[0]?.text ?? '';
      const modulesText = modulesResult.content[0]?.text ?? '';

      return textResult(
        [
          '## PHP Sürümü',
          versionText.trim() || '(bilgi alınamadı)',
          '',
          '## Yüklü Modüller',
          modulesText.trim() || '(bilgi alınamadı)'
        ].join('\n')
      );
    }
  );
};

export const probePhpBinary = async (): Promise<{ available: boolean; version?: string; error?: string }> => {
  try {
    const { runCommand } = await import('../utils/executor.js');
    const result = await runCommand('php', ['-v'], { timeoutMs: 5_000 });
    const firstLine = result.stdout.split('\n')[0]?.trim() ?? '';
    return { available: true, version: firstLine };
  } catch (err) {
    if (isCommandNotFound(err)) {
      return { available: false, error: PHP_MISSING_HINT };
    }
    if (err instanceof ExecError) {
      return { available: false, error: err.stderr.trim() || err.message };
    }
    return { available: false, error: String(err) };
  }
};
