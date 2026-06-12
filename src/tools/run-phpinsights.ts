/**
 * `run_phpinsights` — Run PHP Insights for an overall code-quality score.
 *
 * PHP Insights grades the project across Code, Architecture, Style and
 * Complexity. The output is a compact, colour-coded report. The tool
 * extracts the per-aspect score for the model.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  ANALYZE_EXEC_TIMEOUT_MS,
  PHPINSIGHTS_BIN,
  PHPINSIGHTS_INSTALL_HINT
} from '../constants.js';
import { logger } from '../utils/logger.js';
import { ExecError, isCommandNotFound, runCommand } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  resolveProjectRoot,
  textResult
} from '../utils/responses.js';

export const RUN_PHPINSIGHTS_TOOL = 'run_phpinsights';

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

const SCORE_REGEX = /([A-Z][a-zA-Z]+)\s*[:\-]\s*(\d{1,3}(?:\.\d+)?)\s*%/g;

const extractScores = (text: string): { aspect: string; percent: number }[] => {
  const scores: { aspect: string; percent: number }[] = [];
  let match: RegExpExecArray | null;
  SCORE_REGEX.lastIndex = 0;
  while ((match = SCORE_REGEX.exec(text)) !== null) {
    const aspect = match[1] ?? '';
    const pct = parseFloat(match[2] ?? '0');
    if (['Code', 'Architecture', 'Style', 'Complexity'].includes(aspect)) {
      scores.push({ aspect, percent: pct });
    }
  }
  return scores;
};

export const registerRunPhpInsightsTool = (server: McpServer): void => {
  server.registerTool(
    RUN_PHPINSIGHTS_TOOL,
    {
      title: 'Run PHP Insights',
      description:
        "PHP Insights ile kod kalitesi, mimari, stil ve karmaşıklık üzerinden genel bir skor üretir.",
      inputSchema: z.object({
        fix: z
          .boolean()
          .default(false)
          .describe('Insights tarafından önerilen stil düzeltmelerini uygula. Varsayılan: false.'),
        production: z
          .boolean()
          .default(false)
          .describe('Üretim modunda çalıştır (test dosyaları hariç). Varsayılan: false.'),
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
    async ({ fix, production, projectPath }) => {
      logger.debug('tool.call', { tool: RUN_PHPINSIGHTS_TOOL, fix });

      const workspace = resolveProjectRoot(projectPath);
      const args: string[] = ['--no-interaction', '--ansi=false'];
      if (fix) {
        args.push('--fix');
      }
      if (production) {
        args.push('--production');
      }

      try {
        const result = await runCommand(PHPINSIGHTS_BIN, args, {
          cwd: workspace.root,
          timeoutMs: ANALYZE_EXEC_TIMEOUT_MS
        });
        const clean = stripAnsi(
          result.stderr.trim().length > 0
            ? `${result.stdout}\n${result.stderr}`
            : result.stdout
        );
        const scores = extractScores(clean);
        const scoreBlock =
          scores.length > 0
            ? scores.map((s) => `- **${s.aspect}**: ${s.percent.toFixed(1)}%`).join('\n')
            : '';
        return textResult(`${clean.trim()}${scoreBlock ? `\n\n## Skor Özeti\n${scoreBlock}` : ''}`);
      } catch (err) {
        if (isCommandNotFound(err)) {
          logger.warn('tool.missing_binary', { binary: PHPINSIGHTS_BIN });
          return errorResult(PHPINSIGHTS_INSTALL_HINT);
        }
        if (err instanceof ExecError) {
          const clean = stripAnsi(
            err.stderr.trim().length > 0
              ? `${err.stdout}\n${err.stderr}`
              : err.stdout
          );
          const scores = extractScores(clean);
          const scoreBlock =
            scores.length > 0
              ? scores.map((s) => `- **${s.aspect}**: ${s.percent.toFixed(1)}%`).join('\n')
              : '';
          return textResult(
            `${clean.trim()}${scoreBlock ? `\n\n## Skor Özeti\n${scoreBlock}` : ''}`
          );
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};
