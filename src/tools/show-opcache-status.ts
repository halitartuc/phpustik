/**
 * `show_opcache_status` — Surface OPcache / JIT state for the active PHP CLI.
 *
 * Calls `php -r 'json_encode(opcache_get_status(false))'` and parses the
 * JSON output into a friendly Markdown summary.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { PHP_BIN, PHP_MISSING_HINT } from '../constants.js';
import { runCommand } from '../utils/executor.js';
import { errorResult, formatUnknown, textResult } from '../utils/responses.js';
import { logger } from '../utils/logger.js';

export const SHOW_OPCACHE_STATUS_TOOL = 'show_opcache_status';

interface OpcacheSection {
  readonly title: string;
  readonly rows: readonly { readonly key: string; readonly value: string }[];
}

const stringify = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};

const flatten = (value: unknown, prefix = ''): { key: string; value: string }[] => {
  if (value === null || value === undefined) {
    return [{ key: prefix || 'value', value: stringify(value) }];
  }
  if (typeof value !== 'object') {
    return [{ key: prefix || 'value', value: stringify(value) }];
  }
  const out: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, key));
    } else {
      out.push({ key, value: stringify(v) });
    }
  }
  return out;
};

export const registerShowOpcacheStatusTool = (server: McpServer): void => {
  server.registerTool(
    SHOW_OPCACHE_STATUS_TOOL,
    {
      title: 'Show OPcache / JIT Status',
      description:
        'Aktif PHP CLI için OPcache ve JIT (PHP 8+) durumunu raporlar. opcache eklentisi yüklü değilse bildirir.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      logger.debug('tool.call', { tool: SHOW_OPCACHE_STATUS_TOOL });

      try {
        const result = await runCommand(
          PHP_BIN,
          [
            '-r',
            "if (function_exists('opcache_get_status')) { $s = @opcache_get_status(false); echo json_encode($s ?? ['enabled' => false], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES); } else { echo json_encode(['opcache_loaded' => false]); }"
          ],
          { timeoutMs: 10_000 }
        );

        const raw = result.stdout.trim() || result.stderr.trim();
        if (raw.length === 0) {
          return errorResult(PHP_MISSING_HINT);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return textResult(`OPcache durumu okunamadı. Ham çıktı:\n\n${raw}`);
        }

        const data = parsed as { opcache_loaded?: boolean; enabled?: boolean };
        if (data.opcache_loaded === false) {
          return textResult(
            'OPcache yüklü değil. CLI için opcache.enable_cli=1 ile yükleyin veya php.ini\'de [opcache] bölümünü etkinleştirin.'
          );
        }
        if (data.enabled === false) {
          return textResult('OPcache devre dışı (opcache.enable=0).');
        }

        const sections: OpcacheSection[] = [
          { title: 'Memory', rows: flatten((data as { memory_usage?: unknown }).memory_usage ?? {}) },
          { title: 'Statistics', rows: flatten((data as { opcache_statistics?: unknown }).opcache_statistics ?? {}) },
          { title: 'JIT', rows: flatten((data as { jit?: unknown }).jit ?? {}) }
        ];

        const md = sections
          .map((s) => {
            if (s.rows.length === 0) {
              return `## ${s.title}\n(bilgi yok)`;
            }
            return `## ${s.title}\n${s.rows.map((r) => `- **${r.key}**: ${r.value}`).join('\n')}`;
          })
          .join('\n\n');

        return textResult(md);
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return errorResult(PHP_MISSING_HINT);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
