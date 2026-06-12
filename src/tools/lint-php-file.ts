/**
 * `lint_php_file` — Check a single PHP file for syntax errors via `php -l`.
 *
 * `php -l` is the canonical, zero-config PHP linter. It only catches parse
 * errors and the most basic semantic mistakes, but it's universally
 * available on any system that has a PHP CLI installed.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat } from 'node:fs/promises';
import { DEFAULT_EXEC_TIMEOUT_MS, PHP_MISSING_HINT } from '../constants.js';
import { logger } from '../utils/logger.js';
import { runCommand } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  runWithErrorMapping,
  safeNormalisePath,
  textResult
} from '../utils/responses.js';

export const LINT_PHP_FILE_TOOL = 'lint_php_file';

const LINT_OUTPUT_PATTERN = /No syntax errors detected|Parsing|syntax error|Errors parsing/i;

export const registerLintPhpFileTool = (server: McpServer): void => {
  server.registerTool(
    LINT_PHP_FILE_TOOL,
    {
      title: 'Lint PHP File',
      description:
        "Verilen bir PHP dosyasını sözdizimi hatalarına karşı denetler (php -l). Sadece parse-time hatalarını yakalar, statik analiz yapmaz.",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1, 'Dosya yolu zorunludur.')
          .describe('Lint edilecek PHP dosyasının mutlak veya göreli yolu. Örnek: ./src/Foo.php')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filepath }) => {
      logger.debug('tool.call', { tool: LINT_PHP_FILE_TOOL, filepath });

      const normalised = safeNormalisePath(filepath);
      if (!normalised.ok) {
        return normalised.response;
      }
      const target = normalised.path;

      try {
        const info = await stat(target);
        if (!info.isFile()) {
          return errorResult(`Yol bir dosyaya işaret etmiyor: ${target}`);
        }
      } catch (err) {
        return errorResult(
          `Dosya okunamadı: ${target}\nSebep: ${formatUnknown(err)}`
        );
      }

      // `php -l` exit code 0 = OK, 255 = syntax error found. We pre-flight
      // with the safe executor so missing-binary errors are formatted nicely.
      try {
        await runCommand('php', ['--version'], { timeoutMs: 5_000 });
      } catch {
        return errorResult(PHP_MISSING_HINT);
      }

      const result = await runWithErrorMapping(
        'php',
        ['-l', target],
        { timeoutMs: DEFAULT_EXEC_TIMEOUT_MS },
        { notFoundHint: PHP_MISSING_HINT }
      );

      // runWithErrorMapping always returns; if it was an error, surface as is.
      if (result.isError) {
        return result;
      }

      const raw = result.content[0]?.text ?? '';
      const trimmed = raw.trim();

      if (LINT_OUTPUT_PATTERN.test(trimmed) && /No syntax errors detected/i.test(trimmed)) {
        return textResult(`✅ Sözdizimi hatası yok: ${target}\n\n${trimmed}`);
      }

      // Defensive: if `php -l` returned exit 0 but the message is unexpected
      // we still bubble it up under "no errors detected" to avoid lying.
      return textResult(`ℹ️  Lint çıktısı: ${target}\n\n${trimmed}`);
    }
  );
};
