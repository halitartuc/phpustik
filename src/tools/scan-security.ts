/**
 * Security scanning tools.
 *
 * Four tools, each running a different catalogue of static patterns
 * from `utils/patterns.ts` against the project's source files:
 *
 *   - scan_secrets             (SECRET_PATTERNS)
 *   - scan_vulnerable_functions (VULNERABLE_FUNCTION_PATTERNS)
 *   - scan_sql_injection       (SQL_INJECTION_PATTERNS)
 *   - scan_xss                 (XSS_PATTERNS)
 *
 * The output is a Markdown report grouped by severity, with file:line
 * citations.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../utils/logger.js';
import {
  SECRET_PATTERNS,
  SQL_INJECTION_PATTERNS,
  VULNERABLE_FUNCTION_PATTERNS,
  XSS_PATTERNS
} from '../utils/patterns.js';
import { formatScanSummary, runPatternScan } from '../utils/scan-runner.js';
import {
  errorResult,
  formatUnknown,
  resolveProjectRoot,
  safeNormalisePath,
  textResult
} from '../utils/responses.js';
import { toolCache } from '../utils/cache.js';
import { stat } from 'node:fs/promises';

export const SCAN_SECRETS_TOOL = 'scan_secrets';
export const SCAN_VULNERABLE_FUNCTIONS_TOOL = 'scan_vulnerable_functions';
export const SCAN_SQL_INJECTION_TOOL = 'scan_sql_injection';
export const SCAN_XSS_TOOL = 'scan_xss';

const resolveScanRoot = async (
  projectPath: string | undefined,
  explicitPath: string | undefined
): Promise<{ ok: true; root: string } | { ok: false; response: ReturnType<typeof errorResult> }> => {
  if (explicitPath) {
    const norm = safeNormalisePath(explicitPath);
    if (!norm.ok) {
      return { ok: false, response: norm.response };
    }
    try {
      const info = await stat(norm.path);
      if (!info.isDirectory() && !info.isFile()) {
        return { ok: false, response: errorResult(`Yol taranabilir değil: ${norm.path}`) };
      }
      return { ok: true, root: info.isDirectory() ? norm.path : norm.path };
    } catch (err) {
      return {
        ok: false,
        response: errorResult(`Yol okunamadı: ${norm.path}\nSebep: ${formatUnknown(err)}`)
      };
    }
  }
  const ws = resolveProjectRoot(projectPath);
  return { ok: true, root: ws.root };
};

const cachedScan = async (
  cacheKey: string,
  runner: () => Promise<Awaited<ReturnType<typeof runPatternScan>>>
): Promise<Awaited<ReturnType<typeof runPatternScan>>> =>
  toolCache.getOrCompute(cacheKey, runner, 60_000);

// ──────────────────────────────────────────────────────────────────────
// scan_secrets
// ──────────────────────────────────────────────────────────────────────

export const registerScanSecretsTool = (server: McpServer): void => {
  server.registerTool(
    SCAN_SECRETS_TOOL,
    {
      title: 'Scan for Secrets',
      description:
        "Proje kaynak kodunda hardcoded API key, private key, token ve şifre gibi hassas değerleri arar.",
      inputSchema: z.object({
        path: z.string().optional().describe('Taranacak dizin veya dosya. Belirtilmezse proje kökü.'),
        onlyPhp: z.boolean().default(false).describe('Sadece .php dosyalarını tara. Varsayılan: false.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ path, onlyPhp, projectPath }) => {
      logger.debug('tool.call', { tool: SCAN_SECRETS_TOOL, path });
      const resolved = await resolveScanRoot(projectPath, path);
      if (!resolved.ok) {
        return resolved.response;
      }
      try {
        const summary = await cachedScan(`secrets:${resolved.root}:${onlyPhp}`, () =>
          runPatternScan(resolved.root, SECRET_PATTERNS, { onlyPhp })
        );
        return textResult(formatScanSummary(summary, 'Gizli anahtar taraması'));
      } catch (err) {
        return errorResult(`Tarama başarısız: ${formatUnknown(err)}`);
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// scan_vulnerable_functions
// ──────────────────────────────────────────────────────────────────────

export const registerScanVulnerableFunctionsTool = (server: McpServer): void => {
  server.registerTool(
    SCAN_VULNERABLE_FUNCTIONS_TOOL,
    {
      title: 'Scan Vulnerable Functions',
      description:
        "eval(), unserialize(), system() ve diğer güvensiz fonksiyonların değişken argümanlarla kullanımını tespit eder.",
      inputSchema: z.object({
        path: z.string().optional().describe('Taranacak dizin veya dosya.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ path, projectPath }) => {
      logger.debug('tool.call', { tool: SCAN_VULNERABLE_FUNCTIONS_TOOL, path });
      const resolved = await resolveScanRoot(projectPath, path);
      if (!resolved.ok) {
        return resolved.response;
      }
      try {
        const summary = await cachedScan(`vulnfunc:${resolved.root}`, () =>
          runPatternScan(resolved.root, VULNERABLE_FUNCTION_PATTERNS, { onlyPhp: true })
        );
        return textResult(formatScanSummary(summary, 'Güvensiz fonksiyon taraması'));
      } catch (err) {
        return errorResult(`Tarama başarısız: ${formatUnknown(err)}`);
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// scan_sql_injection
// ──────────────────────────────────────────────────────────────────────

export const registerScanSqlInjectionTool = (server: McpServer): void => {
  server.registerTool(
    SCAN_SQL_INJECTION_TOOL,
    {
      title: 'Scan SQL Injection Patterns',
      description:
        "Sorgu oluştururken string birleştirme veya unsafe raw metodları kullanan kalıpları tespit eder.",
      inputSchema: z.object({
        path: z.string().optional().describe('Taranacak dizin veya dosya.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ path, projectPath }) => {
      logger.debug('tool.call', { tool: SCAN_SQL_INJECTION_TOOL, path });
      const resolved = await resolveScanRoot(projectPath, path);
      if (!resolved.ok) {
        return resolved.response;
      }
      try {
        const summary = await cachedScan(`sqli:${resolved.root}`, () =>
          runPatternScan(resolved.root, SQL_INJECTION_PATTERNS, { onlyPhp: true })
        );
        return textResult(formatScanSummary(summary, 'SQL injection taraması'));
      } catch (err) {
        return errorResult(`Tarama başarısız: ${formatUnknown(err)}`);
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// scan_xss
// ──────────────────────────────────────────────────────────────────────

export const registerScanXssTool = (server: McpServer): void => {
  server.registerTool(
    SCAN_XSS_TOOL,
    {
      title: 'Scan XSS Patterns',
      description:
        "Doğrudan superglobal çıktısı, Blade/Twig unescaped echo ve diğer XSS kalıplarını tespit eder.",
      inputSchema: z.object({
        path: z.string().optional().describe('Taranacak dizin veya dosya.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ path, projectPath }) => {
      logger.debug('tool.call', { tool: SCAN_XSS_TOOL, path });
      const resolved = await resolveScanRoot(projectPath, path);
      if (!resolved.ok) {
        return resolved.response;
      }
      try {
        const summary = await cachedScan(`xss:${resolved.root}`, () =>
          runPatternScan(resolved.root, XSS_PATTERNS, { onlyPhp: true })
        );
        return textResult(formatScanSummary(summary, 'XSS taraması'));
      } catch (err) {
        return errorResult(`Tarama başarısız: ${formatUnknown(err)}`);
      }
    }
  );
};
