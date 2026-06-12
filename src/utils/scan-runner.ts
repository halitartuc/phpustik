/**
 * Common helpers for tools that scan text with a list of patterns.
 *
 * Each tool keeps its own output format, but every scanner has to:
 *   1. iterate patterns,
 *   2. collect matches per file,
 *   3. dedupe overlapping matches,
 *   4. cap the result set to a sane size.
 *
 * `runPatternScan` handles all of the above. Tools just pass in their
 * catalogue and a heading for the report.
 */

import { scanFiles, type ScanResult } from './file-scanner.js';
import type { Pattern, Severity } from './patterns.js';

export interface PatternHit {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly matched: string;
  readonly context: string;
  readonly pattern: Pattern;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

const dedupe = (hits: readonly PatternHit[]): PatternHit[] => {
  const seen = new Set<string>();
  const out: PatternHit[] = [];
  for (const hit of hits) {
    const key = `${hit.file}:${hit.line}:${hit.column}:${hit.pattern.id}:${hit.matched}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(hit);
  }
  return out;
};

const trimContext = (text: string, max = 120): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export interface ScanSummary {
  readonly hits: readonly PatternHit[];
  readonly bySeverity: Record<Severity, number>;
  readonly totalScanned: number;
  readonly truncated: boolean;
  readonly visitedDirs: number;
}

export const runPatternScan = async (
  root: string,
  patterns: readonly Pattern[],
  options: { onlyPhp?: boolean; maxBytes?: number; maxHits?: number } = {}
): Promise<ScanSummary> => {
  const maxHits = options.maxHits ?? 500;
  const scan: ScanResult = await scanFiles({ root, onlyPhp: options.onlyPhp, maxBytes: options.maxBytes });
  const hits: PatternHit[] = [];
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };

  for (const file of scan.files) {
    if (hits.length >= maxHits) {
      break;
    }
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(file.content)) !== null) {
        const matched = match[0];
        const before = file.content.slice(0, match.index);
        const line = before.split('\n').length;
        const column = match.index - before.lastIndexOf('\n');
        const lineText = file.content.split('\n')[line - 1] ?? '';
        hits.push({
          file: file.relative,
          line,
          column,
          matched: trimContext(matched, 80),
          context: trimContext(lineText.trim(), 160),
          pattern
        });
        bySeverity[pattern.severity] += 1;
        if (hits.length >= maxHits) {
          break;
        }
      }
      if (hits.length >= maxHits) {
        break;
      }
    }
  }

  const unique = dedupe(hits).sort((a, b) => {
    const sev = SEVERITY_RANK[b.pattern.severity] - SEVERITY_RANK[a.pattern.severity];
    if (sev !== 0) {
      return sev;
    }
    if (a.file === b.file) {
      return a.line - b.line;
    }
    return a.file.localeCompare(b.file);
  });

  return {
    hits: unique,
    bySeverity,
    totalScanned: scan.files.length,
    truncated: scan.truncated,
    visitedDirs: scan.visitedDirs
  };
};

export const formatScanSummary = (summary: ScanSummary, title: string): string => {
  const total = summary.hits.length;
  if (total === 0) {
    return `✅ ${title}: temiz. ${summary.totalScanned} dosya tarandı.`;
  }
  const sevCounts = (Object.entries(summary.bySeverity) as [Severity, number][])
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s}: ${n}`)
    .join(' · ');
  const header = `⚠️  ${title}: ${total} bulgu (${sevCounts})`;
  const lines = summary.hits.slice(0, 200).map((h) => {
    return `  [${h.pattern.severity.toUpperCase()}] ${h.file}:${h.line}:${h.column}  ${h.pattern.label}\n      match: ${h.matched}\n      code:  ${h.context}`;
  });
  const overflow = total > lines.length ? `\n… +${total - lines.length} daha` : '';
  const truncated = summary.truncated ? '\n(tarama byte limiti nedeniyle erken kesildi)' : '';
  return [header, '', ...lines, overflow, truncated].filter((l) => l !== '').join('\n');
};
