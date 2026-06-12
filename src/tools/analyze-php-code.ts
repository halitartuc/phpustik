/**
 * `analyze_php_code` — Run PHPStan static analysis on a file or directory.
 *
 * The tool invokes the globally installed `phpstan` binary. If the binary
 * is missing the response is a friendly hint that names the exact
 * `composer global require` command needed.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat } from 'node:fs/promises';
import {
  ANALYZE_EXEC_TIMEOUT_MS,
  PHPSTAN_BIN,
  PHPSTAN_INSTALL_HINT,
  PHPSTAN_LEVELS,
  type PhpStanLevel
} from '../constants.js';
import { logger } from '../utils/logger.js';
import { ExecError, isCommandNotFound, runCommand } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  safeNormalisePath,
  textResult
} from '../utils/responses.js';

export const ANALYZE_PHP_CODE_TOOL = 'analyze_php_code';

const cleanText = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, '').trim();

const summarise = (output: string): { hasIssues: boolean; lineCount: number } => {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const hasIssues = lines.some((l) => /error|warning|notice/i.test(l));
  return { hasIssues, lineCount: lines.length };
};

export const registerAnalyzePhpCodeTool = (server: McpServer): void => {
  server.registerTool(
    ANALYZE_PHP_CODE_TOOL,
    {
      title: 'Analyze PHP Code (PHPStan)',
      description:
        "PHPStan ile statik analiz yapar. Dosya veya dizin yolu alabilir. 'level' parametresi 0-9 veya 'max' olabilir.",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1, 'Dosya veya dizin yolu zorunludur.')
          .describe('Analiz edilecek PHP dosyası veya dizini. Örnek: ./src veya ./src/Foo.php'),
        level: z
          .enum(PHPSTAN_LEVELS)
          .default('max')
          .describe("PHPStan analiz seviyesi (0-9 veya 'max'). Varsayılan: max"),
        memoryLimit: z
          .string()
          .default('512M')
          .describe("PHPStan için PHP bellek limiti. Varsayılan: 512M"),
        configuration: z
          .string()
          .optional()
          .describe('İsteğe bağlı phpstan.neon / phpstan.neon.dist yapılandırma yolu.')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filepath, level, memoryLimit, configuration }) => {
      logger.debug('tool.call', { tool: ANALYZE_PHP_CODE_TOOL, filepath, level });

      const normalised = safeNormalisePath(filepath);
      if (!normalised.ok) {
        return normalised.response;
      }
      const target = normalised.path;

      try {
        const info = await stat(target);
        if (!info.isFile() && !info.isDirectory()) {
          return errorResult(`Yol bir dosya veya dizin değil: ${target}`);
        }
      } catch (err) {
        return errorResult(
          `Dosya/dizin okunamadı: ${target}\nSebep: ${formatUnknown(err)}`
        );
      }

      const args: string[] = [
        'analyse',
        target,
        `--level=${level as PhpStanLevel}`,
        '--error-format=raw',
        '--no-progress',
        '--no-interaction',
        `--memory-limit=${memoryLimit}`
      ];

      if (configuration && configuration.trim().length > 0) {
        const config = safeNormalisePath(configuration);
        if (!config.ok) {
          return config.response;
        }
        args.push(`--configuration=${config.path}`);
      }

      try {
        const result = await runCommand(PHPSTAN_BIN, args, {
          timeoutMs: ANALYZE_EXEC_TIMEOUT_MS
        });

        const stdout = cleanText(result.stdout);
        const stderr = cleanText(result.stderr);
        const summary = summarise(`${stdout}\n${stderr}`);

        const header = summary.hasIssues
          ? `⚠️  PHPStan, ${target} üzerinde sorun buldu (seviye: ${level}).`
          : `✅ PHPStan, ${target} üzerinde hata bulamadı (seviye: ${level}).`;

        const body = [stdout, stderr].filter((s) => s.length > 0).join('\n\n');

        return textResult(
          body.length > 0 ? `${header}\n\n${body}` : `${header}\n\n(sessiz çıktı)`
        );
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: PHPSTAN_BIN });
          return errorResult(PHPSTAN_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          // PHPStan returns exit 1 when it finds errors — treat as a normal
          // analysis outcome, not a tool failure.
          if (err.exitCode === 1) {
            const stdout = cleanText(err.stdout);
            const stderr = cleanText(err.stderr);
            const body = [stdout, stderr].filter((s) => s.length > 0).join('\n\n');
            return textResult(
              body.length > 0
                ? `⚠️  PHPStan, ${target} üzerinde sorun buldu (seviye: ${level}).\n\n${body}`
                : `⚠️  PHPStan, ${target} üzerinde sorun buldu (seviye: ${level}).`
            );
          }
          return errorResult(
            `PHPStan başarısız oldu (exit ${err.exitCode}).\n\n${err.stderr.trim() || err.stdout.trim()}`
          );
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
