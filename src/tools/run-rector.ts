/**
 * `run_rector` — Run Rector (automated refactoring) in `dry-run` or `apply` mode.
 *
 * Rector can perform dozens of refactorings (type declarations, code
 * modernisations, dead-code removal, framework upgrades). The project
 * must ship a `rector.php` configuration. The tool always shows the
 * list of changes that *would* be applied before the user toggles
 * `dryRun=false`.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat } from 'node:fs/promises';
import {
  ANALYZE_EXEC_TIMEOUT_MS,
  RECTOR_BIN,
  RECTOR_INSTALL_HINT
} from '../constants.js';
import { logger } from '../utils/logger.js';
import { ExecError, isCommandNotFound, runCommand } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  resolveProjectRoot,
  safeNormalisePath,
  textResult
} from '../utils/responses.js';

export const RUN_RECTOR_TOOL = 'run_rector';

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

export const registerRunRectorTool = (server: McpServer): void => {
  server.registerTool(
    RUN_RECTOR_TOOL,
    {
      title: 'Run Rector (Automated Refactoring)',
      description:
        "Rector ile otomatik refactoring uygular (dryRun=false). 'rector.php' yapılandırması gerekir.",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1)
          .describe('İşlenecek dosya veya dizin. Örnek: ./src'),
        dryRun: z
          .boolean()
          .default(true)
          .describe('Sadece değişiklik önizlemesi (true). Uygulamak için false kullanın. Varsayılan: true.'),
        clearCache: z
          .boolean()
          .default(false)
          .describe('Rector cache temizle. Varsayılan: false.'),
        projectPath: z
          .string()
          .optional()
          .describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filepath, dryRun, clearCache, projectPath }) => {
      logger.debug('tool.call', { tool: RUN_RECTOR_TOOL, filepath, dryRun });

      const normalised = safeNormalisePath(filepath);
      if (!normalised.ok) {
        return normalised.response;
      }
      const target = normalised.path;
      const workspace = resolveProjectRoot(projectPath);

      try {
        const info = await stat(target);
        if (!info.isFile() && !info.isDirectory()) {
          return errorResult(`Yol bir dosya veya dizin değil: ${target}`);
        }
      } catch (err) {
        return errorResult(`Dosya/dizin okunamadı: ${target}\nSebep: ${formatUnknown(err)}`);
      }

      const args: string[] = ['process', target, '--no-progress-bar', '--no-diffs'];
      if (dryRun) {
        args.push('--dry-run');
      }
      if (clearCache) {
        args.push('--clear-cache');
      }

      try {
        const result = await runCommand(RECTOR_BIN, args, {
          cwd: workspace.root,
          timeoutMs: ANALYZE_EXEC_TIMEOUT_MS
        });
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        if (clean.length === 0) {
          return textResult(
            dryRun
              ? `✅ Rector: önerilen değişiklik yok.`
              : `✅ Rector: hiçbir dosya değişmedi.`
          );
        }
        return textResult(clean);
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: RECTOR_BIN });
          return errorResult(RECTOR_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          // Rector exits 0 on dry-run-with-changes, non-zero on errors
          const clean = stripAnsi(
            err.stderr.trim().length > 0
              ? `${err.stdout}\n${err.stderr}`
              : err.stdout
          ).trim();
          if (clean.length > 0) {
            return textResult(clean);
          }
          return textResult(`✅ Rector: değişiklik önerisi yok.`);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
