/**
 * `get_php_ini` — Returns the active `php.ini` locations, scanned
 * directories, and the most relevant `ini` directives.
 *
 * The output is grouped by category (Core, PHP, opcache, etc.) for
 * quick scanning by the model.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { PHP_BIN, PHP_MISSING_HINT } from '../constants.js';
import { runCommand } from '../utils/executor.js';
import { errorResult, formatUnknown, textResult } from '../utils/responses.js';
import { logger } from '../utils/logger.js';

export const GET_PHP_INI_TOOL = 'get_php_ini';

export const registerGetPhpIniTool = (server: McpServer): void => {
  server.registerTool(
    GET_PHP_INI_TOOL,
    {
      title: 'Get PHP INI Info',
      description:
        "Aktif php.ini yollarını, taranan dizinleri ve önemli ini direktiflerini raporlar.",
      inputSchema: z.object({
        directive: z
          .string()
          .optional()
          .describe("İsteğe bağlı olarak tek bir ini direktifinin değerini sorgula. Örnek: memory_limit, max_execution_time.")
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ directive }) => {
      logger.debug('tool.call', { tool: GET_PHP_INI_TOOL, directive });

      try {
        if (directive && directive.length > 0) {
          const value = await runCommand(PHP_BIN, ['-r', `var_export(ini_get(${JSON.stringify(directive)}));`], {
            timeoutMs: 5_000
          });
          const display = value.stdout.trim() || value.stderr.trim();
          if (display.length === 0) {
            return errorResult(PHP_MISSING_HINT);
          }
          return textResult(`\`${directive}\` = ${display}`);
        }

        const result = await runCommand(PHP_BIN, ['-i'], { timeoutMs: 10_000 });
        const text = result.stdout;

        const pathMatch = text.match(/Loaded Configuration File\s*=>\s*([^\n]+)/);
        const scannedMatch = text.match(/additional \.ini files parsed\s*=>\s*([^\n]+)/);
        const scanDirMatch = text.match(/Scan this dir for additional \.ini files\s*=>\s*([^\n]+)/);
        const apiMatch = text.match(/PHP API\s*=>\s*([^\n]+)/);
        const sapiMatch = text.match(/Server API\s*=>\s*([^\n]+)/);

        const sectionRegex = /^(.+?) =>$([\s\S]*?)(?=^[A-Z].*? =>$|\Z)/gm;
        const sections: { name: string; entries: { key: string; value: string }[] }[] = [];
        let match: RegExpExecArray | null;
        while ((match = sectionRegex.exec(text)) !== null) {
          const name = match[1]?.trim() ?? '';
          const body = match[2] ?? '';
          const entries = body
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.includes('=>'))
            .slice(0, 40)
            .map((l) => {
              const idx = l.indexOf('=>');
              return { key: l.slice(0, idx).trim(), value: l.slice(idx + 2).trim() };
            });
          if (entries.length > 0) {
            sections.push({ name, entries });
          }
        }

        const header = [
          '## PHP INI Özeti',
          `**Yüklü ini**: ${pathMatch?.[1]?.trim() ?? '(yok)'}`,
          `**Ek .ini dosyaları**: ${scannedMatch?.[1]?.trim() ?? '(yok)'}`,
          `**Tarama dizini**: ${scanDirMatch?.[1]?.trim() ?? '(yok)'}`,
          `**PHP API**: ${apiMatch?.[1]?.trim() ?? '(yok)'}`,
          `**SAPI**: ${sapiMatch?.[1]?.trim() ?? '(yok)'}`
        ].join('\n');

        const sectionMd = sections
          .slice(0, 12)
          .map((s) => {
            const rows = s.entries
              .slice(0, 15)
              .map((e) => `- \`${e.key}\` = ${e.value}`)
              .join('\n');
            return `### ${s.name}\n${rows}`;
          })
          .join('\n\n');

        return textResult(`${header}\n\n${sectionMd}`);
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return errorResult(PHP_MISSING_HINT);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
