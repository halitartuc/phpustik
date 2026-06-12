/**
 * `run_phpunit` — Run the project's PHPUnit suite.
 *
 * Discovers the PHPUnit binary (project-local `vendor/bin/phpunit` or
 * globally installed), runs the requested test path or filter, and
 * returns a structured Markdown report.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  PHP_BIN,
  PHPUNIT_BIN,
  PHPUNIT_INSTALL_HINT,
  TEST_EXEC_TIMEOUT_MS
} from '../constants.js';
import { logger } from '../utils/logger.js';
import { ExecError, isCommandNotFound, runCommand } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  resolveProjectRoot,
  textResult
} from '../utils/responses.js';

export const RUN_PHPUNIT_TOOL = 'run_phpunit';

const findPhpunit = (cwd: string): string => {
  const candidates = [
    join(cwd, 'vendor', 'bin', 'phpunit'),
    join(cwd, 'vendor', 'bin', 'phpunit.bat')
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return PHPUNIT_BIN;
};

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

const parseTestdox = (text: string): { name: string; status: string }[] => {
  const results: { name: string; status: string }[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([✔✘⚠↩])\s*(.+?)\s*\(.*\)/);
    if (m) {
      const symbol = m[1] ?? '';
      const name = m[2] ?? '';
      const status =
        symbol === '✔'
          ? 'pass'
          : symbol === '✘'
            ? 'fail'
            : symbol === '⚠'
              ? 'warning'
              : symbol === '↩'
                ? 'skipped'
                : 'unknown';
      results.push({ name, status });
    }
  }
  return results;
};

export const registerRunPhpunitTool = (server: McpServer): void => {
  server.registerTool(
    RUN_PHPUNIT_TOOL,
    {
      title: 'Run PHPUnit Tests',
      description:
        "Proje için PHPUnit testlerini çalıştırır. Test yolu, filtre ve testdox formatı desteklenir. Coverage raporu opsiyoneldir.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe('Belirli bir test dosyası veya dizini. Boş bırakılırsa phpunit.xml kullanılır.'),
        filter: z
          .string()
          .optional()
          .describe('--filter değeri. Örnek: testUserCreation'),
        testdox: z.boolean().default(true).describe('İnsan-okunabilir test listesi (--testdox). Varsayılan: true.'),
        coverage: z.boolean().default(false).describe('Coverage raporu üret (Xdebug/PCOV gerekir).'),
        coverageDriver: z
          .enum(['pcov', 'xdebug'])
          .default('pcov')
          .describe('Coverage sürücüsü. PCOV daha hızlıdır.'),
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
    async ({ path, filter, testdox, coverage, coverageDriver, projectPath }) => {
      logger.debug('tool.call', { tool: RUN_PHPUNIT_TOOL, path, filter });

      const workspace = resolveProjectRoot(projectPath);
      const binary = findPhpunit(workspace.root);

      const args: string[] = ['--colors=never'];
      if (testdox) {
        args.push('--testdox');
      }
      if (coverage) {
        args.push(`--coverage-text=-`, `--coverage-clover=${join(workspace.root, 'phpustik-coverage.xml')}`);
      }
      if (filter) {
        args.push('--filter', filter);
      }
      if (path) {
        args.push(path.startsWith(workspace.root) ? relative(workspace.root, path) : path);
      }

      try {
        const result = await runCommand(binary, args, {
          cwd: workspace.root,
          timeoutMs: TEST_EXEC_TIMEOUT_MS,
          env: coverage
            ? { XDEBUG_MODE: coverageDriver === 'xdebug' ? 'coverage' : 'off' }
            : undefined
        });
        const clean = stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
        if (coverage) {
          return textResult(
            `${clean}\n\n**Coverage raporu**: ${join(workspace.root, 'phpustik-coverage.xml')}`
          );
        }
        return textResult(clean);
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary });
          return errorResult(PHPUNIT_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          const clean = stripAnsi(err.stdout + (err.stderr ? '\n' + err.stderr : '')).trim();
          const tests = parseTestdox(clean);
          const failed = tests.filter((t) => t.status === 'fail').length;
          const header =
            failed > 0
              ? `❌ PHPUnit: ${failed} test başarısız.`
              : `✅ PHPUnit: tüm testler geçti.`;
          return textResult(`${header}\n\n${clean}`);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};

void PHP_BIN;
