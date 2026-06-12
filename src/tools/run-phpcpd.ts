/**
 * `run_phpcpd` — Run PHP Copy-Paste Detector to surface duplicated code.
 *
 * CPD tokenises the source and reports blocks of code that appear in
 * more than one place. Useful for surfacing copy-pasted logic that
 * should be factored out.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat } from 'node:fs/promises';
import {
  ANALYZE_EXEC_TIMEOUT_MS,
  PHPCPD_BIN,
  PHPCPD_INSTALL_HINT
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

export const RUN_PHPCPD_TOOL = 'run_phpcpd';

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

export const registerRunPhpCpdTool = (server: McpServer): void => {
  server.registerTool(
    RUN_PHPCPD_TOOL,
    {
      title: 'Run PHP Copy-Paste Detector (PHPCPD)',
      description:
        "Tekrarlanan kod bloklarını tespit eder. Token tabanlı çalışır, küçük kod parçalarını yakalar.",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1)
          .describe('Taranacak dizin. Örnek: ./src'),
        minTokens: z
          .number()
          .int()
          .min(20)
          .default(50)
          .describe('Minimum token sayısı (varsayılan: 50). Daha küçük bloklar göz ardı edilir.'),
        minLines: z
          .number()
          .int()
          .min(3)
          .default(5)
          .describe('Minimum satır sayısı (varsayılan: 5).'),
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
    async ({ filepath, minTokens, minLines, projectPath }) => {
      logger.debug('tool.call', { tool: RUN_PHPCPD_TOOL, filepath });

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

      const args = [
        '--min-tokens',
        String(minTokens),
        '--min-lines',
        String(minLines),
        target
      ];

      try {
        const result = await runCommand(PHPCPD_BIN, args, {
          cwd: workspace.root,
          timeoutMs: ANALYZE_EXEC_TIMEOUT_MS
        });
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        return textResult(clean.length > 0 ? clean : `✅ PHPCPD: tekrarlanan blok bulunamadı.`);
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: PHPCPD_BIN });
          return errorResult(PHPCPD_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          const clean = stripAnsi(
            err.stderr.trim().length > 0
              ? `${err.stdout}\n${err.stderr}`
              : err.stdout
          ).trim();
          return textResult(clean.length > 0 ? clean : `✅ PHPCPD: tekrarlanan blok bulunamadı.`);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
