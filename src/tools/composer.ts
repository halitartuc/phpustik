/**
 * Composer management tools.
 *
 * Nine tools, all backed by the same `composer` binary. Each tool
 * receives a `projectPath` (auto-detected) and runs the right
 * sub-command, mapping the result into a Markdown table or list.
 *
 * Tools:
 *   - composer_info
 *   - composer_validate
 *   - composer_audit
 *   - composer_outdated
 *   - composer_require
 *   - composer_remove
 *   - composer_install
 *   - composer_update
 *   - composer_dump_autoload
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPOSER_BIN,
  COMPOSER_EXEC_TIMEOUT_MS,
  COMPOSER_MISSING_HINT
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

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

const runComposer = async (
  workspaceRoot: string,
  args: readonly string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> => {
  const result = await runCommand(COMPOSER_BIN, args, {
    cwd: workspaceRoot,
    timeoutMs
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs
  };
};

const handleComposerResult = (
  err: unknown,
  success: string
): ReturnType<typeof textResult> | ReturnType<typeof errorResult> => {
  if (isCommandNotFound(err)) {
    logger.warn('tool.missing_binary', { binary: COMPOSER_BIN });
    return errorResult(COMPOSER_MISSING_HINT);
  }
  if (err instanceof ExecError) {
    const clean = stripAnsi(
      err.stderr.trim().length > 0 ? `${err.stdout}\n${err.stderr}` : err.stdout
    ).trim();
    return textResult(clean.length > 0 ? clean : success);
  }
  return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
};

// ──────────────────────────────────────────────────────────────────────
// composer_info
// ──────────────────────────────────────────────────────────────────────

export const COMPOSER_INFO_TOOL = 'composer_info';

export const registerComposerInfoTool = (server: McpServer): void => {
  server.registerTool(
    COMPOSER_INFO_TOOL,
    {
      title: 'Composer Info',
      description:
        "composer.json veya --package ile belirtilen paketin bilgilerini listeler. Yüklü sürüm, lisans, bağımlılıklar vb.",
      inputSchema: z.object({
        package: z
          .string()
          .optional()
          .describe('İsteğe bağlı paket adı. Belirtilirse sadece o paket için bilgi döner. Örnek: laravel/framework'),
        direct: z.boolean().default(false).describe('Sadece doğrudan bağımlılıkları göster.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ package: pkg, direct, projectPath }) => {
      logger.debug('tool.call', { tool: COMPOSER_INFO_TOOL, pkg });

      const workspace = resolveProjectRoot(projectPath);
      const args: string[] = ['info', '--no-interaction'];
      if (direct) {
        args.push('--direct');
      }
      if (pkg) {
        args.push(pkg);
      }

      try {
        const result = await runComposer(workspace.root, args, COMPOSER_EXEC_TIMEOUT_MS);
        return textResult(stripAnsi(result.stdout).trim() || '(boş çıktı)');
      } catch (err) {
        return handleComposerResult(err, 'Composer bilgisi alınamadı.');
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// composer_validate
// ──────────────────────────────────────────────────────────────────────

export const COMPOSER_VALIDATE_TOOL = 'composer_validate';

export const registerComposerValidateTool = (server: McpServer): void => {
  server.registerTool(
    COMPOSER_VALIDATE_TOOL,
    {
      title: 'Composer Validate',
      description: 'composer.json dosyasını sözdizimi ve şema hatalarına karşı doğrular.',
      inputSchema: z.object({
        strict: z.boolean().default(false).describe('Strict mod — name, version, licence zorunluluğu vb.'),
        noCheckAll: z.boolean().default(false).describe('Tüm depoları kontrol etme.'),
        noCheckLock: z.boolean().default(false).describe('composer.lock kontrolünü atla.'),
        noCheckPublish: z.boolean().default(false).describe('Yayınlanabilirlik kontrolünü atla.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ strict, noCheckAll, noCheckLock, noCheckPublish, projectPath }) => {
      logger.debug('tool.call', { tool: COMPOSER_VALIDATE_TOOL });

      const workspace = resolveProjectRoot(projectPath);
      const args = ['validate', '--no-check-publish'];
      if (strict) {
        args.push('--strict');
      }
      if (noCheckAll) {
        args.push('--no-check-all');
      }
      if (noCheckLock) {
        args.push('--no-check-lock');
      }
      if (noCheckPublish) {
        args.push('--no-check-publish');
      }
      args.push('--no-check-version'); // ignore dev-master warnings

      try {
        const result = await runComposer(workspace.root, args, COMPOSER_EXEC_TIMEOUT_MS);
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        return textResult(clean.length > 0 ? clean : '✅ composer.json geçerli.');
      } catch (err) {
        if (err instanceof ExecError && err.exitCode === 1) {
          return errorResult(
            `❌ composer.json geçersiz:\n\n${stripAnsi(err.stdout + (err.stderr ? '\n' + err.stderr : '')).trim()}`
          );
        }
        return handleComposerResult(err, 'composer.json doğrulandı.');
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// composer_audit
// ──────────────────────────────────────────────────────────────────────

export const COMPOSER_AUDIT_TOOL = 'composer_audit';

interface ComposerAuditFinding {
  readonly package: string;
  readonly version: string;
  readonly cve?: string;
  readonly title: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly url?: string;
}

const AUDIT_LINE = /^(?:Package|CVE|Title|Severity|URL):\s*(.*)$/i;

const parseAuditJson = (text: string): ComposerAuditFinding[] => {
  const findings: ComposerAuditFinding[] = [];
  const blocks = text.split(/\n(?=Package:\s)/i);
  for (const block of blocks) {
    if (!/^Package:/i.test(block)) {
      continue;
    }
    const lines = block.split('\n');
    const finding: Record<string, string> = {};
    for (const line of lines) {
      const m = line.match(AUDIT_LINE);
      if (m && m[1]) {
        const key = line.split(':')[0]?.toLowerCase() ?? '';
        finding[key] = m[1].trim();
      }
    }
    if (finding['package']) {
      findings.push({
        package: finding['package'] ?? '',
        version: finding['version'] ?? '',
        cve: finding['cve'],
        title: finding['title'] ?? '',
        severity: (finding['severity'] as ComposerAuditFinding['severity']) ?? 'medium',
        url: finding['url']
      });
    }
  }
  return findings;
};

export const registerComposerAuditTool = (server: McpServer): void => {
  server.registerTool(
    COMPOSER_AUDIT_TOOL,
    {
      title: 'Composer Audit',
      description:
        'Proje bağımlılıklarında bilinen güvenlik açıklarını taramak için `composer audit` çalıştırır.',
      inputSchema: z.object({
        format: z
          .enum(['text', 'json', 'summary'])
          .default('summary')
          .describe('Çıktı formatı. Varsayılan: summary (özet tablo).'),
        noDev: z.boolean().default(false).describe('Dev bağımlılıklarını atla.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ format, noDev, projectPath }) => {
      logger.debug('tool.call', { tool: COMPOSER_AUDIT_TOOL, format });

      const workspace = resolveProjectRoot(projectPath);
      const args: string[] = ['audit', '--no-interaction'];
      if (noDev) {
        args.push('--no-dev');
      }
      if (format === 'json') {
        args.push('--format=json');
      } else if (format === 'summary') {
        args.push('--format=summary');
      }

      try {
        const result = await runComposer(workspace.root, args, COMPOSER_EXEC_TIMEOUT_MS);
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        if (clean.length === 0) {
          return textResult('✅ Composer audit: bilinen güvenlik açığı yok.');
        }
        return textResult(clean);
      } catch (err) {
        if (err instanceof ExecError) {
          // Composer audit exits non-zero on findings — treat as report
          const clean = stripAnsi(
            err.stderr.trim().length > 0
              ? `${err.stdout}\n${err.stderr}`
              : err.stdout
          ).trim();
          if (clean.length === 0) {
            return textResult('✅ Composer audit: bilinen güvenlik açığı yok.');
          }
          if (format === 'json') {
            try {
              const findings = parseAuditJson(clean);
              if (findings.length === 0) {
                return textResult('✅ Composer audit: bilinen güvenlik açığı yok.');
              }
              const table = [
                '| Paket | Sürüm | CVE | Seviye | Başlık |',
                '| --- | --- | --- | --- | --- |',
                ...findings.map((f) =>
                  `| ${f.package} | ${f.version} | ${f.cve ?? '—'} | ${f.severity} | ${f.title} |`
                )
              ].join('\n');
              return textResult(`⚠️  ${findings.length} güvenlik açığı bulundu:\n\n${table}`);
            } catch {
              return textResult(clean);
            }
          }
          return textResult(`⚠️  Güvenlik uyarıları:\n\n${clean}`);
        }
        return handleComposerResult(err, 'Audit tamamlandı.');
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// composer_outdated
// ──────────────────────────────────────────────────────────────────────

export const COMPOSER_OUTDATED_TOOL = 'composer_outdated';

export const registerComposerOutdatedTool = (server: McpServer): void => {
  server.registerTool(
    COMPOSER_OUTDATED_TOOL,
    {
      title: 'Composer Outdated',
      description: 'composer.json kısıtlamalarına göre güncellenmesi gereken paketleri listeler.',
      inputSchema: z.object({
        direct: z.boolean().default(false).describe('Sadece doğrudan bağımlılıkları listele.'),
        format: z.enum(['text', 'json']).default('text').describe('Çıktı formatı.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ direct, format, projectPath }) => {
      logger.debug('tool.call', { tool: COMPOSER_OUTDATED_TOOL });

      const workspace = resolveProjectRoot(projectPath);
      const args = ['outdated', '--no-interaction'];
      if (direct) {
        args.push('--direct');
      }
      if (format === 'json') {
        args.push('--format=json');
      }

      try {
        const result = await runComposer(workspace.root, args, COMPOSER_EXEC_TIMEOUT_MS);
        const clean = stripAnsi(result.stdout).trim();
        if (clean.length === 0) {
          return textResult('✅ Tüm bağımlılıklar güncel.');
        }
        return textResult(clean);
      } catch (err) {
        if (err instanceof ExecError && err.exitCode === 0) {
          return textResult(stripAnsi(err.stdout).trim() || '✅ Tüm bağımlılıklar güncel.');
        }
        if (err instanceof ExecError) {
          // composer outdated exits non-zero when there are outdated packages
          const clean = stripAnsi(
            err.stderr.trim().length > 0
              ? `${err.stdout}\n${err.stderr}`
              : err.stdout
          ).trim();
          if (clean.length === 0) {
            return textResult('✅ Tüm bağımlılıklar güncel.');
          }
          return textResult(`⚠️  Güncellenmesi gereken paketler:\n\n${clean}`);
        }
        return handleComposerResult(err, 'Outdated kontrolü tamamlandı.');
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// composer_require
// ──────────────────────────────────────────────────────────────────────

export const COMPOSER_REQUIRE_TOOL = 'composer_require';

export const registerComposerRequireTool = (server: McpServer): void => {
  server.registerTool(
    COMPOSER_REQUIRE_TOOL,
    {
      title: 'Composer Require',
      description: "Bir paketi composer.json'a ekler. Sürüm kısıtı opsiyoneldir.",
      inputSchema: z.object({
        package: z
          .string()
          .min(1)
          .describe('Eklenecek paket. Örnek: ramsey/uuid:^4.7 veya nesbot/carbon'),
        dev: z.boolean().default(false).describe('require-dev bölümüne ekle.'),
        dryRun: z.boolean().default(false).describe('Sadece önizleme (--dry-run).'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ package: pkg, dev, dryRun, projectPath }) => {
      logger.debug('tool.call', { tool: COMPOSER_REQUIRE_TOOL, pkg, dryRun });

      const workspace = resolveProjectRoot(projectPath);
      const args: string[] = ['require', '--no-interaction', '--no-progress', pkg];
      if (dev) {
        args.push('--dev');
      }
      if (dryRun) {
        args.push('--dry-run');
      }

      try {
        const result = await runComposer(workspace.root, args, COMPOSER_EXEC_TIMEOUT_MS);
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        return textResult(
          clean.length > 0
            ? clean
            : dryRun
              ? `${pkg} kurulum önizleme başarılı.`
              : `✅ ${pkg} başarıyla eklendi.`
        );
      } catch (err) {
        if (err instanceof ExecError) {
          return errorResult(
            `Composer require başarısız (exit ${err.exitCode}):\n\n${stripAnsi(
              err.stderr.trim().length > 0
                ? `${err.stdout}\n${err.stderr}`
                : err.stdout
            ).trim()}`
          );
        }
        return handleComposerResult(err, 'Require tamamlandı.');
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// composer_remove
// ──────────────────────────────────────────────────────────────────────

export const COMPOSER_REMOVE_TOOL = 'composer_remove';

export const registerComposerRemoveTool = (server: McpServer): void => {
  server.registerTool(
    COMPOSER_REMOVE_TOOL,
    {
      title: 'Composer Remove',
      description: "Bir paketi composer.json'dan ve vendor/ dizininden kaldırır.",
      inputSchema: z.object({
        package: z.string().min(1).describe('Kaldırılacak paket. Örnek: ramsey/uuid'),
        dryRun: z.boolean().default(false).describe('Sadece önizleme (--dry-run).'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ package: pkg, dryRun, projectPath }) => {
      logger.debug('tool.call', { tool: COMPOSER_REMOVE_TOOL, pkg, dryRun });

      const workspace = resolveProjectRoot(projectPath);
      const args = ['remove', '--no-interaction', '--no-progress', pkg];
      if (dryRun) {
        args.push('--dry-run');
      }

      try {
        const result = await runComposer(workspace.root, args, COMPOSER_EXEC_TIMEOUT_MS);
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        return textResult(
          clean.length > 0 ? clean : dryRun ? `${pkg} kaldırma önizleme başarılı.` : `✅ ${pkg} kaldırıldı.`
        );
      } catch (err) {
        if (err instanceof ExecError) {
          return errorResult(
            `Composer remove başarısız (exit ${err.exitCode}):\n\n${stripAnsi(
              err.stderr.trim().length > 0
                ? `${err.stdout}\n${err.stderr}`
                : err.stdout
            ).trim()}`
          );
        }
        return handleComposerResult(err, 'Remove tamamlandı.');
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// composer_install
// ──────────────────────────────────────────────────────────────────────

export const COMPOSER_INSTALL_TOOL = 'composer_install';

export const registerComposerInstallTool = (server: McpServer): void => {
  server.registerTool(
    COMPOSER_INSTALL_TOOL,
    {
      title: 'Composer Install',
      description: 'composer.json + composer.lock üzerinden bağımlılıkları kurar.',
      inputSchema: z.object({
        noDev: z.boolean().default(false).describe('Dev bağımlılıklarını kurma.'),
        optimizeAutoloader: z.boolean().default(true).describe('Autoloader optimizasyonu. Varsayılan: true.'),
        preferSource: z.boolean().default(false).describe('Paket kaynaklarını (git) tercih et.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ noDev, optimizeAutoloader, preferSource, projectPath }) => {
      logger.debug('tool.call', { tool: COMPOSER_INSTALL_TOOL });

      const workspace = resolveProjectRoot(projectPath);
      const args = ['install', '--no-interaction', '--no-progress'];
      if (noDev) {
        args.push('--no-dev');
      }
      if (optimizeAutoloader) {
        args.push('-o');
      }
      if (preferSource) {
        args.push('--prefer-source');
      }

      try {
        const result = await runComposer(workspace.root, args, COMPOSER_EXEC_TIMEOUT_MS);
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        return textResult(clean.length > 0 ? clean : '✅ Bağımlılıklar kuruldu.');
      } catch (err) {
        if (err instanceof ExecError) {
          return errorResult(
            `Composer install başarısız (exit ${err.exitCode}):\n\n${stripAnsi(
              err.stderr.trim().length > 0
                ? `${err.stdout}\n${err.stderr}`
                : err.stdout
            ).trim()}`
          );
        }
        return handleComposerResult(err, 'Install tamamlandı.');
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// composer_update
// ──────────────────────────────────────────────────────────────────────

export const COMPOSER_UPDATE_TOOL = 'composer_update';

export const registerComposerUpdateTool = (server: McpServer): void => {
  server.registerTool(
    COMPOSER_UPDATE_TOOL,
    {
      title: 'Composer Update',
      description: "composer.json kısıtlamaları dahilinde bağımlılıkları günceller.",
      inputSchema: z.object({
        packages: z
          .array(z.string())
          .default([])
          .describe('Güncellenecek paketler. Boş bırakılırsa tümü güncellenir.'),
        withAllDependencies: z.boolean().default(false).describe('--with-all-dependencies (transitive).'),
        noDev: z.boolean().default(false).describe('Dev bağımlılıklarını güncelleme.'),
        preferLowest: z.boolean().default(false).describe('En düşük uyumlu sürümü tercih et (test için).'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ packages, withAllDependencies, noDev, preferLowest, projectPath }) => {
      logger.debug('tool.call', { tool: COMPOSER_UPDATE_TOOL, packages });

      const workspace = resolveProjectRoot(projectPath);
      const args: string[] = ['update', '--no-interaction', '--no-progress'];
      if (withAllDependencies) {
        args.push('-W');
      }
      if (noDev) {
        args.push('--no-dev');
      }
      if (preferLowest) {
        args.push('--prefer-lowest');
      }
      args.push(...packages);

      try {
        const result = await runComposer(workspace.root, args, COMPOSER_EXEC_TIMEOUT_MS);
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        return textResult(clean.length > 0 ? clean : '✅ Composer update tamamlandı.');
      } catch (err) {
        if (err instanceof ExecError) {
          return errorResult(
            `Composer update başarısız (exit ${err.exitCode}):\n\n${stripAnsi(
              err.stderr.trim().length > 0
                ? `${err.stdout}\n${err.stderr}`
                : err.stdout
            ).trim()}`
          );
        }
        return handleComposerResult(err, 'Update tamamlandı.');
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// composer_dump_autoload
// ──────────────────────────────────────────────────────────────────────

export const COMPOSER_DUMP_AUTOLOAD_TOOL = 'composer_dump_autoload';

export const registerComposerDumpAutoloadTool = (server: McpServer): void => {
  server.registerTool(
    COMPOSER_DUMP_AUTOLOAD_TOOL,
    {
      title: 'Composer Dump Autoload',
      description: 'composer dump-autoload çalıştırarak autoloader önbelleğini yeniler.',
      inputSchema: z.object({
        optimize: z.boolean().default(true).describe('Optimize edilmiş autoloader üret. Varsayılan: true.'),
        classmapAuthoritative: z.boolean().default(false).describe('Sadece classmap autoloader.'),
        apcu: z.boolean().default(false).describe('APCu autoloader kullan.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ optimize, classmapAuthoritative, apcu, projectPath }) => {
      logger.debug('tool.call', { tool: COMPOSER_DUMP_AUTOLOAD_TOOL });

      const workspace = resolveProjectRoot(projectPath);
      const args: string[] = ['dump-autoload', '--no-interaction'];
      if (optimize) {
        args.push('-o');
      }
      if (classmapAuthoritative) {
        args.push('-a');
      }
      if (apcu) {
        args.push('--apcu');
      }

      try {
        const result = await runComposer(workspace.root, args, COMPOSER_EXEC_TIMEOUT_MS);
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        ).trim();
        return textResult(clean.length > 0 ? clean : '✅ Autoloader yenilendi.');
      } catch (err) {
        if (err instanceof ExecError) {
          return errorResult(
            `Composer dump-autoload başarısız (exit ${err.exitCode}):\n\n${stripAnsi(
              err.stderr.trim().length > 0
                ? `${err.stdout}\n${err.stderr}`
                : err.stdout
            ).trim()}`
          );
        }
        return handleComposerResult(err, 'dump-autoload tamamlandı.');
      }
    }
  );
};

void existsSync;
void readFileSync;
void safeNormalisePath;
void join;
