/**
 * `get_extension_info` — Detailed information about a single PHP extension.
 *
 * Resolves the extension's version, the path of the loaded .so / .dll,
 * the author and the enabled ini directives.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { PHP_BIN, PHP_MISSING_HINT } from '../constants.js';
import { runCommand } from '../utils/executor.js';
import { errorResult, formatUnknown, textResult } from '../utils/responses.js';
import { logger } from '../utils/logger.js';

export const GET_EXTENSION_INFO_TOOL = 'get_extension_info';

const QUERY = `<?php
if (!extension_loaded($argv[1])) {
    fwrite(STDERR, "Extension not loaded: " . $argv[1] . PHP_EOL);
    exit(2);
}
$name = $argv[1];
$ver  = phpversion($name);
$funcs = get_extension_funcs($name) ?: [];
$consts = (new ReflectionExtension($name))->getConstants();
$inis = (new ReflectionExtension($name))->getINIEntries();
$deps = (new ReflectionExtension($name))->getDependencies();
echo json_encode([
    'name' => $name,
    'version' => $ver,
    'function_count' => count($funcs),
    'functions_sample' => array_slice($funcs, 0, 30),
    'constants' => $consts,
    'ini_entries' => $inis,
    'dependencies' => array_map(fn($d) => $d->name . ($d->optional ? ' (optional)' : ''), $deps),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);`;

export const registerGetExtensionInfoTool = (server: McpServer): void => {
  server.registerTool(
    GET_EXTENSION_INFO_TOOL,
    {
      title: 'Get PHP Extension Info',
      description:
        "Bir PHP eklentisinin sürümünü, fonksiyonlarını, sabitlerini, ini girişlerini ve bağımlılıklarını raporlar.",
      inputSchema: z.object({
        extension: z
          .string()
          .min(1)
          .describe('Sorgulanacak eklenti adı. Örnek: pdo, mysqli, opcache, intl, redis.')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ extension }) => {
      logger.debug('tool.call', { tool: GET_EXTENSION_INFO_TOOL, extension });

      try {
        const result = await runCommand(PHP_BIN, ['-r', QUERY, '--', extension], {
          timeoutMs: 10_000
        });

        const raw = result.stdout.trim();
        if (raw.length === 0) {
          return errorResult(
            result.stderr.trim() || `Eklenti yüklü değil: ${extension}. 'php -m' ile yüklü eklentileri listeleyin.`
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return textResult(`Eklenti bilgisi parse edilemedi:\n\n${raw}`);
        }
        const data = parsed as {
          name: string;
          version: string | false;
          function_count: number;
          functions_sample: string[];
          constants: Record<string, string | number | boolean | null>;
          ini_entries: Record<string, string>;
          dependencies: string[];
        };

        const lines = [
          `## Eklenti: ${data.name}`,
          `**Sürüm**: ${data.version || '(yok)'}`,
          `**Fonksiyon sayısı**: ${data.function_count}`,
          `**Bağımlılıklar**: ${data.dependencies.length > 0 ? data.dependencies.join(', ') : '(yok)'}`,
          '',
          '### Fonksiyonlar (ilk 30)',
          data.functions_sample.length > 0
            ? data.functions_sample.map((f) => `- \`${f}()\``).join('\n')
            : '(yok)',
          '',
          '### Sabitler',
          Object.keys(data.constants).length > 0
            ? Object.entries(data.constants)
                .map(([k, v]) => `- \`${k}\` = ${JSON.stringify(v)}`)
                .join('\n')
            : '(yok)',
          '',
          '### INI girişleri',
          Object.keys(data.ini_entries).length > 0
            ? Object.entries(data.ini_entries)
                .map(([k, v]) => `- \`${k}\` = \`${v}\``)
                .join('\n')
            : '(yok)'
        ];
        return textResult(lines.join('\n'));
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return errorResult(PHP_MISSING_HINT);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
