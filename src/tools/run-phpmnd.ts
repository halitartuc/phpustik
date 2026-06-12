/**
 * `run_phpmnd` — Run PHP Magic Number Detector.
 *
 * Flags numeric literals that are not 0, 1, -1, 2 (or short array
 * indices) and are not assigned to a constant. Useful for promoting
 * named constants over magic numbers.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat } from 'node:fs/promises';
import {
  ANALYZE_EXEC_TIMEOUT_MS,
  PHPMND_BIN,
  PHPMND_INSTALL_HINT
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

export const RUN_PHPMND_TOOL = 'run_phpmnd';

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

export const registerRunPhpmndTool = (server: McpServer): void => {
  server.registerTool(
    RUN_PHPMND_TOOL,
    {
      title: 'Run PHP Magic Number Detector (PHPMND)',
      description:
        "Sayısal sabitleri tespit eder ve bunların 'const' olarak tanımlanmasını önerir.",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1)
          .describe('Taranacak dosya veya dizin. Örnek: ./src'),
        extensions: z
          .array(z.string())
          .default(['php'])
          .describe("Dosya uzantıları. Varsayılan: ['php']."),
        exclude: z
          .array(z.string())
          .default(['vendor', 'node_modules', 'tests', 'test'])
          .describe('Hariç tutulacak dizinler.'),
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
    async ({ filepath, extensions, exclude, projectPath }) => {
      logger.debug('tool.call', { tool: RUN_PHPMND_TOOL, filepath });

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
        '--non-zero-only',
        '--allow-array-constants',
        '--progress=none'
      ];
      for (const ext of extensions) {
        args.push(`--extensions=${ext}`);
      }
      for (const exc of exclude) {
        args.push(`--exclude=${exc}`);
      }
      args.push(target);

      try {
        const result = await runCommand(PHPMND_BIN, args, {
          cwd: workspace.root,
          timeoutMs: ANALYZE_EXEC_TIMEOUT_MS
        });
        const clean = stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
        return textResult(clean.length > 0 ? clean : `✅ PHPMND: magic number bulunamadı.`);
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: PHPMND_BIN });
          return errorResult(PHPMND_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          const clean = stripAnsi(err.stdout + (err.stderr ? '\n' + err.stderr : '')).trim();
          return textResult(clean.length > 0 ? clean : `✅ PHPMND: magic number bulunamadı.`);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
