/**
 * `check_php_compatibility` — Run `phpcs` with `PHPCompatibility` ruleset
 * against the target file/directory to surface code that will break on
 * a given PHP version.
 *
 * Requires both PHP_CodeSniffer and the PHPCompatibility standard to be
 * installed (the standard is usually pulled in as a Composer dev
 * dependency of the project).
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { stat } from 'node:fs/promises';
import {
  ANALYZE_EXEC_TIMEOUT_MS,
  PHPCS_BIN,
  PHPCS_INSTALL_HINT
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

export const CHECK_PHP_COMPATIBILITY_TOOL = 'check_php_compatibility';

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

const SUPPORTED_VERSIONS = [
  '5.3',
  '5.4',
  '5.5',
  '5.6',
  '7.0',
  '7.1',
  '7.2',
  '7.3',
  '7.4',
  '8.0',
  '8.1',
  '8.2',
  '8.3',
  '8.4'
] as const;

type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

export const registerCheckPhpCompatibilityTool = (server: McpServer): void => {
  server.registerTool(
    CHECK_PHP_COMPATIBILITY_TOOL,
    {
      title: 'Check PHP Version Compatibility',
      description:
        "PHPCompatibility standard'ı ile kodu belirli bir PHP sürümü için denetler. Hem PHP hem de sözdizimi/semantik geriye/ileriye uyumsuzlukları yakalar.",
      inputSchema: z.object({
        filepath: z
          .string()
          .min(1)
          .describe('Denetlenecek dosya veya dizin. Örnek: ./src veya ./src/Foo.php'),
        targetVersion: z
          .enum(SUPPORTED_VERSIONS)
          .default('8.1')
          .describe('Test edilecek minimum PHP sürümü. Varsayılan: 8.1.'),
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
    async ({ filepath, targetVersion, projectPath }) => {
      logger.debug('tool.call', {
        tool: CHECK_PHP_COMPATIBILITY_TOOL,
        filepath,
        targetVersion
      });

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
        '--standard=PHPCompatibility',
        `--runtime-set=testVersion ${targetVersion as SupportedVersion}`,
        '--report=full',
        '--report-width=120',
        '--no-cache',
        '-p',
        target
      ];

      try {
        const result = await runCommand(PHPCS_BIN, args, {
          cwd: workspace.root,
          timeoutMs: ANALYZE_EXEC_TIMEOUT_MS
        });
        const clean = stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
        if (clean.length === 0) {
          return textResult(`✅ PHP ${targetVersion} uyumluluğu: temiz.`);
        }
        return textResult(`PHP ${targetVersion} uyumluluk raporu:\n\n${clean}`);
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: PHPCS_BIN });
          return errorResult(
            `${PHPCS_INSTALL_HINT}\nAyrıca: 'composer require --dev phpcompatibility/php-compatibility' ekleyin.`
          );
        }
        if (err instanceof ExecError) {
          // phpcs returns non-zero on findings; treat as report
          const clean = stripAnsi(
            (err.stdout + (err.stderr ? '\n' + err.stderr : ''))
          ).trim();
          if (clean.length > 0) {
            return textResult(`⚠️  PHP ${targetVersion} uyumsuzlukları:\n\n${clean}`);
          }
          return textResult(`✅ PHP ${targetVersion} uyumluluğu: temiz.`);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
