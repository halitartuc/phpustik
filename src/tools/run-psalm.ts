/**
 * `run_psalm` — Run Psalm static analysis at a configurable error level.
 *
 * Psalm complements PHPStan: it has stronger generic / template support
 * and excellent Laravel / Doctrine integrations. The tool runs `psalm`
 * with `--output-format=text` and surfaces the report.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat } from 'node:fs/promises';
import {
  ANALYZE_EXEC_TIMEOUT_MS,
  PSALM_BIN,
  PSALM_INSTALL_HINT,
  PSALM_LEVELS,
  type PsalmLevel
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

export const RUN_PSALM_TOOL = 'run_psalm';

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

export const registerRunPsalmTool = (server: McpServer): void => {
  server.registerTool(
    RUN_PSALM_TOOL,
    {
      title: 'Run Psalm Static Analysis',
      description:
        "Psalm ile statik analiz yapar. PHPStan'ın tamamlayıcısıdır. Hata seviyesi 1-8 arası veya 'auto' olabilir.",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1)
          .describe('Psalm ile analiz edilecek dosya veya dizin. Örnek: ./src'),
        level: z
          .enum(PSALM_LEVELS)
          .default('4')
          .describe("Psalm hata seviyesi (1-8). Varsayılan: 4 (orta)."),
        showInfo: z.boolean().default(false).describe('info seviyesindeki uyarıları da göster.'),
        threads: z
          .number()
          .int()
          .min(1)
          .max(16)
          .default(4)
          .describe('Paralel iş parçacığı sayısı. Varsayılan: 4.'),
        projectPath: z
          .string()
          .optional()
          .describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filepath, level, showInfo, threads, projectPath }) => {
      logger.debug('tool.call', { tool: RUN_PSALM_TOOL, filepath, level });

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

      const args: string[] = [
        '--no-progress',
        '--no-suggestions',
        '--no-cache',
        '--threads',
        String(threads),
        '--output-format=text'
      ];
      if (showInfo) {
        args.push('--show-info=true');
      }
      args.push(`--set-level=${level as PsalmLevel}`, target);

      try {
        const result = await runCommand(PSALM_BIN, args, {
          cwd: workspace.root,
          timeoutMs: ANALYZE_EXEC_TIMEOUT_MS
        });
        const clean = stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
        return textResult(clean.length > 0 ? clean : `✅ Psalm: temiz (seviye ${level}).`);
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: PSALM_BIN });
          return errorResult(PSALM_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          // Psalm exits non-zero on errors — treat as report
          const clean = stripAnsi(err.stdout + (err.stderr ? '\n' + err.stderr : '')).trim();
          return textResult(clean.length > 0 ? clean : `✅ Psalm: temiz (seviye ${level}).`);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
