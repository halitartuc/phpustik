/**
 * `run_phpmd` — Run PHP Mess Detector with a configurable ruleset.
 *
 * Common rulesets: `cleancode`, `codesize`, `controversial`,
 * `design`, `naming`, `unusedcode`. The default covers the most
 * common issues with a low false-positive rate.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat } from 'node:fs/promises';
import {
  ANALYZE_EXEC_TIMEOUT_MS,
  PHPMD_BIN,
  PHPMD_INSTALL_HINT
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

export const RUN_PHPMD_TOOL = 'run_phpmd';

const RULESETS = [
  'cleancode',
  'codesize',
  'controversial',
  'design',
  'naming',
  'unusedcode'
] as const;

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

export const registerRunPhpmdTool = (server: McpServer): void => {
  server.registerTool(
    RUN_PHPMD_TOOL,
    {
      title: 'Run PHP Mess Detector (PHPMD)',
      description:
        "PHPMD ile kod karmaşıklığı, kullanılmayan kod, tasarım sorunları ve adlandırma ihlallerini raporlar.",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1)
          .describe('PHPMD tarafından taranacak dosya veya dizin. Örnek: ./src'),
        rulesets: z
          .array(z.enum(RULESETS))
          .default(['cleancode', 'codesize', 'design', 'naming', 'unusedcode'])
          .describe('Kullanılacak kurallar. Varsayılan: cleancode,codesize,design,naming,unusedcode.'),
        format: z
          .enum(['text', 'json', 'xml', 'sarif'])
          .default('text')
          .describe('Çıktı formatı. Varsayılan: text.'),
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
    async ({ filepath, rulesets, format, projectPath }) => {
      logger.debug('tool.call', { tool: RUN_PHPMD_TOOL, filepath, rulesets });

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

      const formatFlag = format;
      const args = [target, formatFlag, rulesets.join(',')];

      try {
        const result = await runCommand(PHPMD_BIN, args, {
          cwd: workspace.root,
          timeoutMs: ANALYZE_EXEC_TIMEOUT_MS
        });
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        if (clean.length === 0) {
          return textResult(`✅ PHPMD: temiz (${rulesets.join(',')}).`);
        }
        return textResult(clean);
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: PHPMD_BIN });
          return errorResult(PHPMD_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          const clean = stripAnsi(
            err.stderr.trim().length > 0
              ? `${err.stdout}\n${err.stderr}`
              : err.stdout
          ).trim();
          return textResult(clean.length > 0 ? clean : `✅ PHPMD: temiz (${rulesets.join(',')}).`);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
