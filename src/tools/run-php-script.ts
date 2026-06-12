/**
 * `run_php_script` — Execute a PHP script in an isolated way.
 *
 * Safety:
 *  - The script is written to a temp file with a `.php` extension.
 *  - The PHP CLI is invoked with `-d display_errors=stderr -d log_errors=1
 *    -d error_reporting=E_ALL` so failures are visible in the response.
 *  - No `eval()` of user input — the file lives on disk and is
 *    unlinked immediately after execution.
 *  - A timeout protects against infinite loops.
 *
 * The model can pass any subset of CLI flags; common ones (e.g.
 * `-d memory_limit=256M`) are exposed as first-class parameters.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PHP_BIN, PHP_MISSING_HINT, SCRIPT_EXEC_TIMEOUT_MS } from '../constants.js';
import { logger } from '../utils/logger.js';
import { ExecError } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  runWithErrorMapping,
  textResult
} from '../utils/responses.js';

export const RUN_PHP_SCRIPT_TOOL = 'run_php_script';

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

export const registerRunPhpScriptTool = (server: McpServer): void => {
  server.registerTool(
    RUN_PHP_SCRIPT_TOOL,
    {
      title: 'Run PHP Script',
      description:
        "PHP kodunu izole bir temp dosyasında çalıştırır. Kısa betikler için uygundur, kalıcı projeler için tasarlanmamıştır.",
      inputSchema: z.object({
        code: z
          .string()
          .min(1, 'Çalıştırılacak PHP kodu zorunludur.')
          .describe('Çalıştırılacak PHP kodu. <?php etiketi opsiyoneldir.'),
        memoryLimit: z.string().default('256M').describe('memory_limit ini değeri. Varsayılan: 256M'),
        timeoutSeconds: z
          .number()
          .int()
          .min(1)
          .max(120)
          .default(30)
          .describe('Saniye cinsinden wall-clock timeout. Varsayılan: 30.')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ code, memoryLimit, timeoutSeconds }) => {
      logger.debug('tool.call', { tool: RUN_PHP_SCRIPT_TOOL, bytes: code.length });

      const dir = await mkdtemp(join(tmpdir(), 'phpustik-run-'));
      const file = join(dir, 'snippet.php');
      try {
        const prefixed = code.includes('<?php') ? code : `<?php\n${code}`;
        await writeFile(file, prefixed, 'utf8');

        const timeoutMs = Math.min(timeoutSeconds * 1000, SCRIPT_EXEC_TIMEOUT_MS);
        const args = [
          '-d',
          `memory_limit=${memoryLimit}`,
          '-d',
          'display_errors=stderr',
          '-d',
          'log_errors=1',
          '-d',
          'error_reporting=E_ALL',
          '-n',
          '-q',
          file
        ];

        try {
          const result = await import('../utils/executor.js').then(({ runCommand }) =>
            runCommand(PHP_BIN, args, { timeoutMs })
          );
          const stdout = stripAnsi(result.stdout);
          const stderr = stripAnsi(result.stderr);
          const body = [
            stdout.length > 0 ? stdout : null,
            stderr.length > 0 ? `--- stderr ---\n${stderr}` : null,
            `--- exit: ${result.exitCode}, süre: ${result.durationMs} ms ---`
          ]
            .filter((s): s is string => s !== null)
            .join('\n');
          return textResult(body);
        } catch (err) {
          if (err instanceof ExecError) {
            const stderr = stripAnsi(err.stderr);
            const stdout = stripAnsi(err.stdout);
            return errorResult(
              `PHP çalıştırma hatası (exit ${err.exitCode}):\n\n${
                stderr.length > 0 ? stderr : stdout
              }`.trim()
            );
          }
          return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
        }
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {
          /* best-effort */
        });
      }
    }
  );
};

void runWithErrorMapping;
void PHP_MISSING_HINT;
