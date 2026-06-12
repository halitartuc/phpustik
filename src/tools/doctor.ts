/**
 * `phpustik_doctor` — the killer feature.
 *
 * Runs the full PHP project health check in a single tool call:
 *
 *   composer_validate, composer_audit, analyze_php_code, run_phpcs,
 *   run_phpmd, run_phpunit, scan_secrets, scan_vulnerable_functions,
 *   scan_sql_injection, scan_xss, check_php_compatibility,
 *   suggest_refactoring, get_php_ini, detect_framework, get_php_info
 *
 * Produces a single Markdown report plus a typed `DoctorReport`
 * structured content that the model can iterate over without
 * parsing Markdown tables.
 *
 * Categories: composer | runtime | static | style | security | tests
 * Modes: all (default) | security | quality | style
 * Options: --fix (auto-fix what can be auto-fixed), --skip-tests
 *          (skip slow PHP unit suite), --fail-on (severity threshold)
 */

import * as z from 'zod/v4';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import {
  formatUnknown,
  resolveProjectRoot,
  textResult,
  type ToolResponse
} from '../utils/responses.js';
import { runCommand, isCommandNotFound } from '../utils/executor.js';
import { logger } from '../utils/logger.js';
import { progress as emitProgress, mcpLog } from '../utils/notification-sink.js';
import {
  formatScanSummary,
  runPatternScan
} from '../utils/scan-runner.js';
import {
  PHP_BIN,
  PHP_MISSING_HINT,
  PHPSTAN_BIN,
  PHPSTAN_INSTALL_HINT,
  PHPCS_BIN,
  PHPCS_INSTALL_HINT,
  PHPMD_BIN,
  PHPMD_INSTALL_HINT,
  PHPSTAN_LEVELS,
  COMPOSER_MISSING_HINT,
  COMPOSER_EXEC_TIMEOUT_MS,
  ANALYZE_EXEC_TIMEOUT_MS,
  FORMAT_EXEC_TIMEOUT_MS
} from '../constants.js';
import { runComposer } from '../utils/composer-shared.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  SECRET_PATTERNS,
  VULNERABLE_FUNCTION_PATTERNS,
  SQL_INJECTION_PATTERNS,
  XSS_PATTERNS
} from '../utils/patterns.js';

export const DOCTOR_TOOL = 'phpustik_doctor';

const CHECK_TIMEOUT_MS = 60_000;

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped';
type CheckSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type CheckCategory = 'composer' | 'runtime' | 'static' | 'style' | 'security' | 'tests' | 'compat';

interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly category: CheckCategory;
  readonly status: CheckStatus;
  readonly severity: CheckSeverity;
  readonly summary: string;
  readonly details?: string;
  readonly fixable: boolean;
  readonly durationMs: number;
}

interface DoctorReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly projectRoot: string;
  readonly framework: string;
  readonly phpVersion: string | null;
  readonly category: string;
  readonly failOn: CheckSeverity;
  readonly overallStatus: CheckStatus;
  readonly totals: {
    readonly total: number;
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
    readonly skipped: number;
    readonly fixable: number;
  };
  readonly checks: readonly CheckResult[];
  readonly recommendations: readonly string[];
}

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

const safeExecText = async (
  command: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ ok: true; stdout: string; stderr: string; exitCode: number } | { ok: false; reason: string }> => {
  try {
    const r = await runCommand(command, args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? CHECK_TIMEOUT_MS
    });
    return { ok: true, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
  } catch (err) {
    if (isCommandNotFound(err)) {
      return { ok: false, reason: 'missing-binary' };
    }
    if (err instanceof Error && err.name === 'ExecError') {
      const e = err as unknown as { stdout: string; stderr: string; exitCode: number };
      return { ok: true, stdout: e.stdout, stderr: e.stderr, exitCode: e.exitCode };
    }
    return { ok: false, reason: formatUnknown(err) };
  }
};

const emptyResult = (id: string, title: string, category: CheckCategory, status: CheckStatus, summary: string, fixable = false): CheckResult => ({
  id,
  title,
  category,
  status,
  severity: 'info',
  summary,
  fixable,
  durationMs: 0
});

const timed = async (id: string, title: string, category: CheckCategory, fn: () => Promise<CheckResult>): Promise<CheckResult> => {
  const started = Date.now();
  try {
    const result = await fn();
    return { ...result, durationMs: Date.now() - started };
  } catch (err) {
    return {
      id,
      title,
      category,
      status: 'fail',
      severity: 'high',
      summary: `Check başarısız: ${formatUnknown(err)}`,
      fixable: false,
      durationMs: Date.now() - started
    };
  }
};

const detectFrameworkCheck = async (ws: { root: string; isLaravel: boolean; isSymfony: boolean }): Promise<CheckResult> => {
  const fw = ws.isLaravel ? 'Laravel' : ws.isSymfony ? 'Symfony' : '(plain PHP)';
  return {
    id: 'detect_framework',
    title: 'Framework tespiti',
    category: 'runtime',
    status: ws.isLaravel || ws.isSymfony ? 'pass' : 'warn',
    severity: 'info',
    summary: `Tespit edilen: ${fw}`,
    fixable: false,
    durationMs: 0
  };
};

const phpVersionCheck = async (): Promise<CheckResult> => {
  const result = await safeExecText(PHP_BIN, ['-v'], { timeoutMs: 5_000 });
  if (!result.ok) {
    return {
      id: 'php_version',
      title: 'PHP sürümü',
      category: 'runtime',
      status: 'fail',
      severity: 'critical',
      summary: PHP_MISSING_HINT,
      fixable: false,
      durationMs: 0
    };
  }
  const firstLine = result.stdout.split('\n')[0]?.trim() ?? '?';
  const versionMatch = firstLine.match(/PHP (\d+\.\d+(?:\.\d+)?)/);
  const version = versionMatch?.[1] ?? '?';
  const major = parseInt(version.split('.')[0] ?? '0', 10);
  const status: CheckStatus = major >= 8 ? 'pass' : 'fail';
  return {
    id: 'php_version',
    title: 'PHP sürümü',
    category: 'runtime',
    status,
    severity: status === 'pass' ? 'info' : 'high',
    summary: `PHP ${version} (minimum 8.0 önerilir)`,
    fixable: false,
    durationMs: 0
  };
};

const composerValidateCheck = async (ws: { root: string }): Promise<CheckResult> => {
  const result = await runComposer(ws.root, ['validate', '--no-check-publish', '--no-check-version'], COMPOSER_EXEC_TIMEOUT_MS);
  if (!result.ok) {
    return emptyResult('composer_validate', 'composer.json doğrulama', 'composer', 'skipped', `Composer bulunamadı. ${COMPOSER_MISSING_HINT}`);
  }
  const out = stripAnsi(result.stderr || result.stdout);
  if (result.exitCode === 0) {
    return {
      id: 'composer_validate',
      title: 'composer.json doğrulama',
      category: 'composer',
      status: 'pass',
      severity: 'info',
      summary: 'composer.json geçerli.',
      fixable: false,
      durationMs: 0
    };
  }
  return {
    id: 'composer_validate',
    title: 'composer.json doğrulama',
    category: 'composer',
    status: 'fail',
    severity: 'high',
    summary: 'composer.json geçersiz.',
    details: out,
    fixable: false,
    durationMs: 0
  };
};

const composerAuditCheck = async (ws: { root: string }): Promise<CheckResult> => {
  const result = await runComposer(ws.root, ['audit', '--no-interaction', '--format=summary'], COMPOSER_EXEC_TIMEOUT_MS);
  if (!result.ok) {
    return emptyResult('composer_audit', 'Güvenlik açığı taraması', 'security', 'skipped', `Composer bulunamadı. ${COMPOSER_MISSING_HINT}`);
  }
  const clean = stripAnsi(result.stderr || result.stdout).trim();
  if (result.exitCode === 0) {
    return {
      id: 'composer_audit',
      title: 'Bilinen CVE taraması',
      category: 'security',
      status: 'pass',
      severity: 'info',
      summary: 'Bilinen güvenlik açığı yok.',
      fixable: false,
      durationMs: 0
    };
  }
  const m = clean.match(/(\d+)\s+package/);
  const count = m?.[1] ?? '?';
  return {
    id: 'composer_audit',
    title: 'Bilinen CVE taraması',
    category: 'security',
    status: 'fail',
    severity: 'critical',
    summary: `${count} paket CVE içeriyor.`,
    details: clean.slice(0, 2000),
    fixable: true,
    durationMs: 0
  };
};

  const phpstanCheck = async (ws: { root: string }): Promise<CheckResult> => {
  const exists = existsSync(join(ws.root, 'phpstan.neon')) || existsSync(join(ws.root, 'phpstan.neon.dist'));
  if (!exists) {
    return emptyResult('phpstan', 'PHPStan statik analiz', 'static', 'skipped', 'phpstan.neon bulunamadı — `phpustik_init` ile üretebilirsiniz.');
  }
  const args = ['analyse', '--no-progress', '--no-interaction', '--error-format=raw', '--memory-limit=512M'];
  const result = await safeExecText(PHPSTAN_BIN, args, { cwd: ws.root, timeoutMs: ANALYZE_EXEC_TIMEOUT_MS });
  void PHPSTAN_BIN;
  if (!result.ok) {
    return emptyResult('phpstan', 'PHPStan statik analiz', 'static', 'skipped', PHPSTAN_INSTALL_HINT);
  }
  const clean = stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
  if (result.exitCode === 0 && clean.length === 0) {
    return {
      id: 'phpstan',
      title: 'PHPStan statik analiz',
      category: 'static',
      status: 'pass',
      severity: 'info',
      summary: 'Statik analiz temiz.',
      fixable: false,
      durationMs: 0
    };
  }
  if (result.exitCode === 0) {
    return {
      id: 'phpstan',
      title: 'PHPStan statik analiz',
      category: 'static',
      status: 'pass',
      severity: 'info',
      summary: clean.split('\n').slice(0, 3).join(' / '),
      fixable: false,
      durationMs: 0
    };
  }
  const errorCount = clean.split('\n').filter((l) => l.trim().length > 0).length;
  return {
    id: 'phpstan',
    title: 'PHPStan statik analiz',
    category: 'static',
    status: 'fail',
    severity: 'high',
    summary: `${errorCount} hata bulundu.`,
    details: clean.slice(0, 3000),
    fixable: false,
    durationMs: 0
  };
};

const phpcsCheck = async (ws: { root: string }): Promise<CheckResult> => {
  const exists = existsSync(join(ws.root, 'phpcs.xml')) || existsSync(join(ws.root, 'phpcs.xml.dist'));
  if (!exists) {
    return emptyResult('phpcs', 'PHP_CodeSniffer', 'style', 'skipped', 'phpcs.xml bulunamadı.');
  }
  const result = await safeExecText(
    PHPCS_BIN,
    ['--standard=phpcs.xml', '-n', '--report=summary', 'src/', 'app/'],
    { cwd: ws.root, timeoutMs: FORMAT_EXEC_TIMEOUT_MS }
  );
  if (!result.ok) {
    return emptyResult('phpcs', 'PHP_CodeSniffer', 'style', 'skipped', PHPCS_INSTALL_HINT);
  }
  const clean = stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
  if (result.exitCode === 0) {
    return {
      id: 'phpcs',
      title: 'PHP_CodeSniffer (PSR-12)',
      category: 'style',
      status: 'pass',
      severity: 'info',
      summary: clean || 'Stil ihlali yok.',
      fixable: true,
      durationMs: 0
    };
  }
  return {
    id: 'phpcs',
    title: 'PHP_CodeSniffer (PSR-12)',
    category: 'style',
    status: 'fail',
    severity: 'medium',
    summary: clean.split('\n')[0] ?? 'Stil ihlalleri var.',
    details: clean.slice(0, 2000),
    fixable: true,
    durationMs: 0
  };
};

const phpmdCheck = async (ws: { root: string }): Promise<CheckResult> => {
  const exists = existsSync(join(ws.root, 'phpmd.xml')) || existsSync(join(ws.root, 'phpmd.xml.dist'));
  if (!exists) {
    return emptyResult('phpmd', 'PHP Mess Detector', 'static', 'skipped', 'phpmd.xml bulunamadı.');
  }
  const result = await safeExecText(
    PHPMD_BIN,
    ['src/', 'text', 'phpmd.xml'],
    { cwd: ws.root, timeoutMs: ANALYZE_EXEC_TIMEOUT_MS }
  );
  if (!result.ok) {
    return emptyResult('phpmd', 'PHP Mess Detector', 'static', 'skipped', PHPMD_INSTALL_HINT);
  }
  const clean = stripAnsi(result.stdout).trim();
  if (result.exitCode === 0 && clean.length === 0) {
    return {
      id: 'phpmd',
      title: 'PHP Mess Detector',
      category: 'static',
      status: 'pass',
      severity: 'info',
      summary: 'Kod kalitesi temiz.',
      fixable: false,
      durationMs: 0
    };
  }
  const findings = clean.split('\n').filter((l) => l.trim().length > 0).length;
  return {
    id: 'phpmd',
    title: 'PHP Mess Detector',
    category: 'static',
    status: findings > 0 ? 'fail' : 'pass',
    severity: 'medium',
    summary: `${findings} bulgu.`,
    details: clean.slice(0, 2000),
    fixable: false,
    durationMs: 0
  };
};

const phpunitCheck = async (ws: { root: string }, skipTests: boolean): Promise<CheckResult> => {
  if (skipTests) {
    return emptyResult('phpunit', 'PHPUnit testleri', 'tests', 'skipped', 'skipTests=true ile atlandı.');
  }
  const configExists = existsSync(join(ws.root, 'phpunit.xml')) || existsSync(join(ws.root, 'phpunit.xml.dist'));
  const binary = existsSync(join(ws.root, 'vendor', 'bin', 'phpunit')) ? join('vendor', 'bin', 'phpunit') : 'phpunit';
  const args = configExists ? ['--colors=never', '--testdox'] : ['--colors=never'];
  const result = await safeExecText(binary, args, { cwd: ws.root, timeoutMs: 120_000 });
  if (!result.ok && result.reason === 'missing-binary') {
    return emptyResult('phpunit', 'PHPUnit testleri', 'tests', 'skipped', 'phpunit yüklü değil (composer require --dev phpunit/phpunit).');
  }
  if (!result.ok) {
    return emptyResult('phpunit', 'PHPUnit testleri', 'tests', 'skipped', `Çalıştırılamadı: ${result.reason}`);
  }
  const clean = stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
  if (result.exitCode === 0) {
    const m = clean.match(/OK \((\d+) tests?/);
    const testCount = m?.[1] ?? '?';
    return {
      id: 'phpunit',
      title: 'PHPUnit testleri',
      category: 'tests',
      status: 'pass',
      severity: 'info',
      summary: `${testCount} test geçti.`,
      fixable: false,
      durationMs: 0
    };
  }
  const failMatch = clean.match(/(\d+) failures?/);
  const errorMatch = clean.match(/(\d+) errors?/);
  const failCount = parseInt(failMatch?.[1] ?? '0', 10);
  const errorCount = parseInt(errorMatch?.[1] ?? '0', 10);
  return {
    id: 'phpunit',
    title: 'PHPUnit testleri',
    category: 'tests',
    status: 'fail',
    severity: failCount + errorCount > 0 ? 'high' : 'medium',
    summary: `${failCount} failure, ${errorCount} error.`,
    details: clean.slice(-2000),
    fixable: false,
    durationMs: 0
  };
};

const patternScanCheck = async (
  id: string,
  title: string,
  root: string,
  patterns: readonly typeof SECRET_PATTERNS[number][],
  scanId: string
): Promise<CheckResult> => {
  try {
    const summary = await runPatternScan(root, patterns, { onlyPhp: true });
    if (summary.hits.length === 0) {
      return {
        id,
        title,
        category: 'security',
        status: 'pass',
        severity: 'info',
        summary: `${summary.totalScanned} dosya tarandı, bulgu yok.`,
        fixable: false,
        durationMs: 0
      };
    }
    const criticalCount = summary.bySeverity.critical;
    const status: CheckStatus = criticalCount > 0 ? 'fail' : 'warn';
    return {
      id,
      title,
      category: 'security',
      status,
      severity: criticalCount > 0 ? 'critical' : 'high',
      summary: `${summary.hits.length} bulgu (${scanId})`,
      details: formatScanSummary(summary, title).slice(0, 2000),
      fixable: false,
      durationMs: 0
    };
  } catch (err) {
    return {
      id,
      title,
      category: 'security',
      status: 'warn',
      severity: 'low',
      summary: `Tarama atlandı: ${formatUnknown(err)}`,
      fixable: false,
      durationMs: 0
    };
  }
};

const secretsCheck = (root: string) => patternScanCheck('scan_secrets', 'Hardcoded secret taraması', root, SECRET_PATTERNS, 'secrets');
const vulnFuncCheck = (root: string) => patternScanCheck('scan_vulnerable_functions', 'Güvensiz fonksiyon taraması', root, VULNERABLE_FUNCTION_PATTERNS, 'vuln-funcs');
const sqliCheck = (root: string) => patternScanCheck('scan_sql_injection', 'SQL injection taraması', root, SQL_INJECTION_PATTERNS, 'sqli');
const xssCheck = (root: string) => patternScanCheck('scan_xss', 'XSS taraması', root, XSS_PATTERNS, 'xss');

const phpIniCheck = async (): Promise<CheckResult> => {
  const result = await safeExecText(PHP_BIN, ['-i'], { timeoutMs: 5_000 });
  if (!result.ok) {
    return emptyResult('php_ini', 'PHP INI kontrolü', 'runtime', 'skipped', PHP_MISSING_HINT);
  }
  const text = result.stdout;
  const displayErrors = /display_errors\s*=>\s*On/i.test(text);
  const exposePhp = /expose_php\s*=>\s*On/i.test(text);
  if (displayErrors || exposePhp) {
    return {
      id: 'php_ini',
      title: 'PHP INI kontrolü',
      category: 'runtime',
      status: 'warn',
      severity: 'medium',
      summary: 'display_errors veya expose_php açık. Üretim için kapatın.',
      fixable: false,
      durationMs: 0
    };
  }
  return {
    id: 'php_ini',
    title: 'PHP INI kontrolü',
    category: 'runtime',
    status: 'pass',
    severity: 'info',
    summary: 'PHP INI ayarları güvenli görünüyor.',
    fixable: false,
    durationMs: 0
  };
};

const refactoringSuggestionCheck = async (ws: { root: string }): Promise<CheckResult> => {
  const { scanFiles } = await import('../utils/file-scanner.js');
  try {
    const scan = await scanFiles({ root: ws.root, onlyPhp: true, maxBytes: 32 * 1024 * 1024 });
    let longMethodCount = 0;
    let godClassCount = 0;
    let evalCount = 0;
    for (const file of scan.files) {
      const lines = file.content.split('\n');
      let cur: { name: string; depth: number; start: number } | null = null;
      for (let i = 0; i < lines.length; i += 1) {
        const ln = lines[i] ?? '';
        const opens = (ln.match(/\{/g) ?? []).length;
        const closes = (ln.match(/\}/g) ?? []).length;
        const fn = ln.match(/function\s+&?(\w+)\s*\(/);
        if (fn && !cur) {
          cur = { name: fn[1] ?? '?', depth: 0, start: i };
        }
        if (cur) {
          cur.depth += opens - closes;
          if (cur.depth <= 0 && (opens > 0 || closes > 0)) {
            if (i - cur.start + 1 > 60) {
              longMethodCount += 1;
            }
            cur = null;
          }
        }
        if (ln.includes('eval(')) {
          evalCount += 1;
        }
      }
      if (lines.length > 800) {
        godClassCount += 1;
      }
    }
    const total = longMethodCount + godClassCount + evalCount;
    if (total === 0) {
      return {
        id: 'refactor_suggestions',
        title: 'Refactoring önerileri',
        category: 'static',
        status: 'pass',
        severity: 'info',
        summary: `${scan.files.length} dosya tarandı, uzun metot/god class/eval bulunmadı.`,
        fixable: false,
        durationMs: 0
      };
    }
    return {
      id: 'refactor_suggestions',
      title: 'Refactoring önerileri',
      category: 'static',
      status: 'warn',
      severity: 'medium',
      summary: `${longMethodCount} uzun metot, ${godClassCount} büyük sınıf, ${evalCount} eval().`,
      fixable: false,
      durationMs: 0
    };
  } catch (err) {
    return {
      id: 'refactor_suggestions',
      title: 'Refactoring önerileri',
      category: 'static',
      status: 'warn',
      severity: 'low',
      summary: `Taramada hata: ${formatUnknown(err)}`,
      fixable: false,
      durationMs: 0
    };
  }
};

const readComposerJsonIfExists = async (ws: { composerJson: string | null }): Promise<Record<string, unknown> | null> => {
  if (!ws.composerJson) {
    return null;
  }
  try {
    return JSON.parse(await readFile(ws.composerJson, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const SEVERITY_RANK: Record<CheckSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

const STATUS_RANK: Record<CheckStatus, number> = {
  fail: 3,
  warn: 2,
  pass: 1,
  skipped: 0
};
void STATUS_RANK;

const buildReport = (checks: readonly CheckResult[], projectRoot: string, framework: string, phpVersion: string | null, category: string, failOn: CheckSeverity): DoctorReport => {
  const pass = checks.filter((c) => c.status === 'pass').length;
  const warn = checks.filter((c) => c.status === 'warn').length;
  const fail = checks.filter((c) => c.status === 'fail').length;
  const skipped = checks.filter((c) => c.status === 'skipped').length;
  const fixable = checks.filter((c) => c.fixable).length;

  const failThreshold = SEVERITY_RANK[failOn];
  const overall: CheckStatus =
    checks.some((c) => c.status === 'fail' && SEVERITY_RANK[c.severity] >= failThreshold)
      ? 'fail'
      : checks.some((c) => c.status === 'fail')
        ? 'warn'
        : warn > 0
          ? 'warn'
          : 'pass';

  const recommendations: string[] = [];
  for (const c of checks) {
    if (c.status === 'fail') {
      if (c.fixable) {
        recommendations.push(`🔧 **${c.title}**: otomatik düzeltilebilir (fix parametresi ile).`);
      } else {
        recommendations.push(`⚠️  **${c.title}**: ${c.summary}`);
      }
    } else if (c.status === 'skipped' && c.severity === 'info' && /bulunamadı|değil/.test(c.summary)) {
      recommendations.push(`📝 **${c.title}**: ${c.summary}`);
    }
  }

  return {
    startedAt: checks[0] ? new Date(Date.now() - checks.reduce((s, c) => s + c.durationMs, 0)).toISOString() : new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    projectRoot,
    framework,
    phpVersion,
    category,
    failOn,
    overallStatus: overall,
    totals: { total: checks.length, pass, warn, fail, skipped, fixable },
    checks,
    recommendations
  };
};

const renderMarkdown = (report: DoctorReport): string => {
  const icon: Record<CheckStatus, string> = { pass: '✅', warn: '⚠️ ', fail: '❌', skipped: '⏭️ ' };
  const lines: string[] = [];
  lines.push(`# 🩺 phpustik doctor — ${report.overallStatus === 'pass' ? 'Sağlıklı' : report.overallStatus === 'warn' ? 'Uyarılar var' : 'Kritik sorunlar var'}`);
  lines.push('');
  lines.push(`**Proje**: \`${report.projectRoot}\``);
  lines.push(`**Framework**: ${report.framework}`);
  lines.push(`**PHP**: ${report.phpVersion ?? 'bilinmiyor'}`);
  lines.push(`**Kategori**: ${report.category}`);
  lines.push(`**Fail-on**: ${report.failOn}`);
  lines.push(`**Tarih**: ${report.finishedAt}`);
  lines.push('');
  lines.push('## Özet');
  lines.push(`- ✅ Pass: ${report.totals.pass}`);
  lines.push(`- ⚠️  Warn: ${report.totals.warn}`);
  lines.push(`- ❌ Fail: ${report.totals.fail}`);
  lines.push(`- ⏭️  Skipped: ${report.totals.skipped}`);
  lines.push(`- 🔧 Fixable: ${report.totals.fixable}`);
  lines.push('');
  lines.push('## Bulgular');
  lines.push('');
  lines.push('| Status | Kategori | Check | Severity | Sonuç | Süre |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const c of report.checks) {
    lines.push(
      `| ${icon[c.status]} | ${c.category} | ${c.title} | ${c.severity} | ${c.summary.replace(/\|/g, '\\|')} | ${c.durationMs}ms |`
    );
  }
  if (report.recommendations.length > 0) {
    lines.push('');
    lines.push('## Öneriler');
    lines.push('');
    for (const r of report.recommendations) {
      lines.push(`- ${r}`);
    }
  }
  const failDetails = report.checks.filter((c) => c.status === 'fail' && c.details);
  if (failDetails.length > 0) {
    lines.push('');
    lines.push('## Detaylar (başarısız olanlar)');
    lines.push('');
    for (const c of failDetails) {
      lines.push(`### ${c.title}`);
      lines.push('');
      if (c.details) {
        lines.push('```');
        lines.push(c.details);
        lines.push('```');
      }
      lines.push('');
    }
  }
  return lines.join('\n');
};

export const registerDoctorTool = (server: McpServer): void => {
  server.registerTool(
    DOCTOR_TOOL,
    {
      title: 'PHP project health check',
      description:
        "Tek çağrıda composer, PHP runtime, statik analiz, stil, güvenlik ve test kontrollerini çalıştırır. Öncelikli, actionable bir rapor döner.",
      inputSchema: z.object({
        category: z
          .enum(['all', 'security', 'quality', 'style'])
          .default('all')
          .describe("Hangi kategorileri çalıştır: all | security | quality | style. Varsayılan: all."),
        failOn: z
          .enum(['critical', 'high', 'medium', 'low', 'info'])
          .default('high')
          .describe('Bu seviyede ve üzerinde hata varsa overallStatus=fail. Varsayılan: high.'),
        skipTests: z.boolean().default(false).describe('PHPUnit atla (uzun sürer). Varsayılan: false.'),
        fix: z.boolean().default(false).describe('Otomatik düzeltilebilir olanları uygula. Varsayılan: false.'),
        phpstanLevel: z
          .enum(PHPSTAN_LEVELS)
          .default('max')
          .describe('PHPStan seviyesi. Varsayılan: max.'),
        json: z.boolean().default(false).describe('Sadece structured JSON (text çıktıyı gizle).'),
        projectPath: z.string().optional().describe('Proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (
      { category, failOn, skipTests, fix, json, projectPath },
      _ctx: ServerContext
    ): Promise<ToolResponse> => {
      logger.info('tool.call', { tool: DOCTOR_TOOL, category, failOn, fix });
      const ws = resolveProjectRoot(projectPath);
      const composerJson = await readComposerJsonIfExists(ws);
      const framework = ws.isLaravel ? 'Laravel' : ws.isSymfony ? 'Symfony' : '(plain PHP)';
      const phpVersion = (composerJson?.['require'] as Record<string, string> | undefined)?.['php'] ?? null;
      void phpVersion;

      const checks: CheckResult[] = [];
      const totalSteps = 12;
      let step = 0;
      const advance = async (label: string): Promise<void> => {
        step += 1;
        await emitProgress({ current: step, total: totalSteps, message: label });
        await mcpLog('info', `[doctor] ${label}`);
      };

      await advance('Framework tespiti');
      checks.push(await timed('detect_framework', 'Framework', 'runtime', () => detectFrameworkCheck(ws)));

      await advance('PHP sürümü');
      checks.push(await timed('php_version', 'PHP sürümü', 'runtime', () => phpVersionCheck()));

      const wantSecurity = category === 'all' || category === 'security';
      const wantQuality = category === 'all' || category === 'quality';
      const wantStyle = category === 'all' || category === 'style';

      if (wantSecurity) {
        await advance('Composer audit');
        checks.push(await timed('composer_audit', 'Composer güvenlik taraması', 'security', () => composerAuditCheck(ws)));
        await advance('Hardcoded secrets');
        checks.push(await timed('scan_secrets', 'Hardcoded secrets', 'security', () => secretsCheck(ws.root)));
        await advance('Güvensiz fonksiyonlar');
        checks.push(await timed('scan_vulnerable_functions', 'Güvensiz fonksiyonlar', 'security', () => vulnFuncCheck(ws.root)));
        await advance('SQL injection kalıpları');
        checks.push(await timed('scan_sql_injection', 'SQL injection kalıpları', 'security', () => sqliCheck(ws.root)));
        await advance('XSS kalıpları');
        checks.push(await timed('scan_xss', 'XSS kalıpları', 'security', () => xssCheck(ws.root)));
        await advance('PHP INI');
        checks.push(await timed('php_ini', 'PHP INI kontrolü', 'runtime', () => phpIniCheck()));
      }

      if (wantQuality) {
        await advance('Composer validate');
        checks.push(await timed('composer_validate', 'composer.json doğrulama', 'composer', () => composerValidateCheck(ws)));
        await advance('PHPStan');
        checks.push(await timed('phpstan', 'PHPStan', 'static', () => phpstanCheck(ws)));
        await advance('PHPMD');
        checks.push(await timed('phpmd', 'PHPMD', 'static', () => phpmdCheck(ws)));
        await advance('Refactoring önerileri');
        checks.push(await timed('refactor_suggestions', 'Refactoring önerileri', 'static', () => refactoringSuggestionCheck(ws)));
      }

      if (wantStyle) {
        await advance('PHPCS');
        checks.push(await timed('phpcs', 'PHPCS (PSR-12)', 'style', () => phpcsCheck(ws)));
      }

      await advance('PHPUnit');
      checks.push(await timed('phpunit', 'PHPUnit', 'tests', () => phpunitCheck(ws, skipTests)));

      await mcpLog('info', `[doctor] Tüm ${checks.length} check tamamlandı.`);

      const report = buildReport(checks, ws.root, framework, null, category, failOn);
      const md = renderMarkdown(report);

      if (json) {
        return textResult(JSON.stringify(report, null, 2), report as unknown as Record<string, unknown>);
      }
      const isFail = report.overallStatus === 'fail';
      return {
        content: [{ type: 'text' as const, text: md }],
        isError: isFail,
        structuredContent: report as unknown as Record<string, unknown>
      };
    }
  );
};
