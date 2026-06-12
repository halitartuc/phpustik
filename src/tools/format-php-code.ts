/**
 * `format_php_code` — Auto-format a PHP file with PHP-CS-Fixer.
 *
 * Operates in "dry-run" mode by default so the model can preview the
 * diff safely. Pass `dryRun: false` to actually apply the rewrite.
 *
 * PSR-12 is the de-facto PHP coding standard and matches the project's
 * PHP conventions.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat, copyFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FORMAT_EXEC_TIMEOUT_MS,
  PHP_CS_FIXER_BIN,
  PHP_CS_FIXER_INSTALL_HINT
} from '../constants.js';
import { logger } from '../utils/logger.js';
import { ExecError, isCommandNotFound, runCommand } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  safeNormalisePath,
  textResult
} from '../utils/responses.js';

export const FORMAT_PHP_CODE_TOOL = 'format_php_code';

const buildFixerArgs = (target: string, dryRun: boolean): string[] => {
  const args: string[] = [
    'fix',
    target,
    '--diff',
    '--using-cache=no',
    '--no-interaction'
  ];
  if (dryRun) {
    args.push('--dry-run');
  }
  return args;
};

const ensureBackup = async (target: string): Promise<{ dir: string; backup: string }> => {
  const dir = await mkdtemp(join(tmpdir(), 'phpustik-fmt-'));
  const backup = join(dir, 'original.php');
  await copyFile(target, backup);
  return { dir, backup };
};

const captureDryRun = async (
  target: string
): Promise<{ changed: boolean; diff: string; error: string }> => {
  try {
    const result = await runCommand(PHP_CS_FIXER_BIN, buildFixerArgs(target, true), {
      timeoutMs: FORMAT_EXEC_TIMEOUT_MS
    });
    return { changed: false, diff: result.stdout, error: result.stderr };
  } catch (err) {
    if (err instanceof ExecError) {
      // exit code 8 == "would have been fixed" in PHP-CS-Fixer
      return { changed: true, diff: err.stdout, error: err.stderr };
    }
    throw err;
  }
};

export const registerFormatPhpCodeTool = (server: McpServer): void => {
  server.registerTool(
    FORMAT_PHP_CODE_TOOL,
    {
      title: 'Format PHP Code (PHP-CS-Fixer)',
      description:
        "PHP-CS-Fixer (PSR-12) ile bir PHP dosyasını formatlar. 'dryRun' true ise sadece diff gösterir, false ise dosyayı yerinde günceller.",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1, 'Dosya yolu zorunludur.')
          .describe('Formatlanacak PHP dosyasının yolu. Örnek: ./src/Foo.php'),
        dryRun: z
          .boolean()
          .default(true)
          .describe('Sadece önizleme diff gösterir (true). Dosyayı yazmak için false kullanın.'),
        createBackup: z
          .boolean()
          .default(false)
          .describe('Format öncesi orijinali geçici bir dizine yedekler. Varsayılan: false.')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filepath, dryRun, createBackup }) => {
      logger.debug('tool.call', { tool: FORMAT_PHP_CODE_TOOL, filepath, dryRun });

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
        return errorResult(`Dosya okunamadı: ${target}\nSebep: ${formatUnknown(err)}`);
      }

      let backupDir: string | null = null;
      try {
        if (!dryRun && createBackup) {
          const backup = await ensureBackup(target);
          backupDir = backup.dir;
        }

        if (dryRun) {
          const { changed, diff, error } = await captureDryRun(target);
          const cleanedDiff = diff.trim();
          const cleanedError = error.trim();
          const body = [cleanedDiff, cleanedError].filter((s) => s.length > 0).join('\n\n');
          return textResult(
            changed
              ? `🔍 Değişiklik gerekli: ${target}\n\n${body || '(diff boş)'}`
              : `✅ Dosya zaten PSR-12 uyumlu: ${target}\n\n${body || '(değişiklik yok)'}`
          );
        }

        // Real run — measure before/after so the model can confirm the rewrite.
        const before = await readFile(target, 'utf8');
        await runCommand(PHP_CS_FIXER_BIN, buildFixerArgs(target, false), {
          timeoutMs: FORMAT_EXEC_TIMEOUT_MS
        });
        const after = await readFile(target, 'utf8');
        const changed = before !== after;
        const delta = after.length - before.length;
        return textResult(
          changed
            ? `✨ Dosya formatlandı: ${target}\n\nKarakter farkı: ${delta >= 0 ? '+' : ''}${delta}.`
            : `✅ Dosya zaten PSR-12 uyumlu, değişiklik yapılmadı: ${target}`
        );
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: PHP_CS_FIXER_BIN });
          return errorResult(PHP_CS_FIXER_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          return errorResult(
            `PHP-CS-Fixer başarısız oldu (exit ${err.exitCode}).\n\n${err.stderr.trim() || err.stdout.trim()}`
          );
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      } finally {
        if (backupDir) {
          await rm(backupDir, { recursive: true, force: true }).catch(() => {
            /* best-effort cleanup */
          });
        }
      }
    }
  );
};
