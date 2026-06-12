/**
 * `run_phpcs` — Run PHP_CodeSniffer with a given standard.
 *
 * Common standards: `PSR12`, `PSR1`, `PSR2`, `Squiz`, `PEAR`,
 * `Zend`, `CakePHP`. Project-local `phpcs.xml` is honoured when
 * no standard is supplied.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat } from 'node:fs/promises';
import { ANALYZE_EXEC_TIMEOUT_MS, PHPCS_BIN, PHPCS_INSTALL_HINT } from '../constants.js';
import { logger } from '../utils/logger.js';
import { ExecError, isCommandNotFound, runCommand } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  resolveProjectRoot,
  safeNormalisePath,
  textResult
} from '../utils/responses.js';

export const RUN_PHPCS_TOOL = 'run_phpcs';

const STANDARDS = [
  'PSR12',
  'PSR1',
  'PSR2',
  'Squiz',
  'PEAR',
  'Zend',
  'CakePHP',
  'Generic',
  'MySource'
] as const;

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

export const registerRunPhpcsTool = (server: McpServer): void => {
  server.registerTool(
    RUN_PHPCS_TOOL,
    {
      title: 'Run PHP_CodeSniffer (PHPCS)',
      description:
        "PHP_CodeSniffer ile kod stili / PSR ihlallerini raporlar. 'fix' parametresi true ise otomatik düzeltme yapar (phpcbf).",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1)
          .describe('Taranacak dosya veya dizin. Örnek: ./src'),
        standard: z
          .enum(STANDARDS)
          .default('PSR12')
          .describe('Kod stili standardı. Varsayılan: PSR12. Boş bırakılırsa phpcs.xml kullanılır.'),
        severity: z
          .enum(['warning', 'error'])
          .default('warning')
          .describe('Minimum raporlama seviyesi. Varsayılan: warning.'),
        fix: z.boolean().default(false).describe('Otomatik düzeltme uygula (phpcbf kullanır). Varsayılan: false.'),
        projectPath: z
          .string()
          .optional()
          .describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filepath, standard, severity, fix, projectPath }) => {
      logger.debug('tool.call', { tool: RUN_PHPCS_TOOL, filepath, standard, fix });

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

      const bin = fix ? PHPCS_BIN.replace('phpcs', 'phpcbf') : PHPCS_BIN;
      const args: string[] = [
        `--standard=${standard}`,
        `-n` /* no cache */,
        `--report=full`,
        `--report-width=120`,
        `--severity=${severity}`,
        target
      ];
      if (!fix) {
        args.push('-s'); // show sniff codes
      }

      try {
        const result = await runCommand(bin, args, {
          cwd: workspace.root,
          timeoutMs: ANALYZE_EXEC_TIMEOUT_MS
        });
        const clean = stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
        return textResult(clean.length > 0 ? clean : `✅ ${standard}: temiz.`);
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: bin });
          return errorResult(PHPCS_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          const clean = stripAnsi(err.stdout + (err.stderr ? '\n' + err.stderr : '')).trim();
          if (clean.length > 0) {
            const header = fix ? `🔧 ${standard} düzeltmeleri:` : `⚠️  ${standard} ihlalleri:`;
            return textResult(`${header}\n\n${clean}`);
          }
          return textResult(`✅ ${standard}: temiz.`);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
