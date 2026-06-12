/**
 * Code generation and refactoring tools.
 *
 * Three tools, all operating on single PHP files:
 *
 *   - add_strict_types      (prepends `declare(strict_types=1);`)
 *   - generate_phpdoc       (inserts PHPDoc blocks via reflection)
 *   - suggest_refactoring   (heuristic long-method / god-class / naming report)
 *
 * Heuristics are intentionally lightweight: the goal is to give the
 * model a fast first pass, not to replace a real refactoring session.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { PHP_BIN, PHP_MISSING_HINT, DEFAULT_EXEC_TIMEOUT_MS } from '../constants.js';
import { logger } from '../utils/logger.js';
import { ExecError, runCommand } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  resolveProjectRoot,
  safeNormalisePath,
  textResult
} from '../utils/responses.js';

// ──────────────────────────────────────────────────────────────────────
// add_strict_types
// ──────────────────────────────────────────────────────────────────────

export const ADD_STRICT_TYPES_TOOL = 'add_strict_types';

const STRICT_TAG = 'declare(strict_types=1);';

export const registerAddStrictTypesTool = (server: McpServer): void => {
  server.registerTool(
    ADD_STRICT_TYPES_TOOL,
    {
      title: 'Add declare(strict_types=1)',
      description:
        "Bir PHP dosyasının en üstüne 'declare(strict_types=1);' ekler (yoksa). 'dryRun=true' ile önizleme.",
      inputSchema: z.object({
        filepath: z.string().min(1).describe('Hedef dosya. Örnek: ./src/Foo.php'),
        dryRun: z.boolean().default(true).describe('Sadece önizleme. Varsayılan: true.'),
        force: z.boolean().default(false).describe('Mevcut declare(strict_types=...) satırını değiştir.')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filepath, dryRun, force }) => {
      logger.debug('tool.call', { tool: ADD_STRICT_TYPES_TOOL, filepath, dryRun });

      const normalised = safeNormalisePath(filepath);
      if (!normalised.ok) {
        return normalised.response;
      }
      const target = normalised.path;

      try {
        const info = await stat(target);
        if (!info.isFile()) {
          return errorResult(`Yol bir dosyaya işaret etmiyor: ${target}`);
        }
      } catch (err) {
        return errorResult(`Dosya okunamadı: ${target}\nSebep: ${formatUnknown(err)}`);
      }

      const original = await readFile(target, 'utf8');
      const hasStrict = /^\s*<\?(?:php)?\s+declare\s*\(\s*strict_types\s*=\s*1\s*\)\s*;/i.test(original);
      if (hasStrict && !force) {
        return textResult(`ℹ️  Dosya zaten strict_types içeriyor: ${target}`);
      }

      const updated = injectStrictTypes(original);
      if (updated === original) {
        return textResult(`ℹ️  Değişiklik gerekmiyor: ${target}`);
      }

      if (dryRun) {
        const preview = diffPreview(original, updated);
        return textResult(`🔍 Önizleme: ${target}\n\n${preview}`);
      }
      await writeFile(target, updated, 'utf8');
      return textResult(`✨ declare(strict_types=1); eklendi: ${target}`);
    }
  );
};

const injectStrictTypes = (source: string): string => {
  if (/^\s*<\?(?:php)?\s+declare\s*\(\s*strict_types\s*=\s*1\s*\)\s*;/i.test(source)) {
    return source;
  }
  const phpTag = source.match(/^\s*<\?(?:php)?\s*/i);
  if (phpTag) {
    const idx = (phpTag.index ?? 0) + phpTag[0].length;
    return `${source.slice(0, idx)}${STRICT_TAG}\n${source.slice(idx)}`;
  }
  return `<?php\n${STRICT_TAG}\n\n${source}`;
};

const diffPreview = (a: string, b: string): string => {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(aLines.length, bLines.length); i += 1) {
    const al = aLines[i];
    const bl = bLines[i];
    if (al !== bl) {
      if (al !== undefined) {
        out.push(`- ${al}`);
      }
      if (bl !== undefined) {
        out.push(`+ ${bl}`);
      }
    }
  }
  return out.join('\n');
};

// ──────────────────────────────────────────────────────────────────────
// generate_phpdoc
// ──────────────────────────────────────────────────────────────────────

export const GENERATE_PHPDOC_TOOL = 'generate_phpdoc';

const PHPDOC_QUERY = `<?php
$file = $argv[1];
require_once $file;
$declared = get_declared_classes();
$out = [];
foreach ($declared as $class) {
    $r = new ReflectionClass($class);
    if ($r->getFileName() !== realpath($file)) continue;
    $cls = ['name' => $r->getName(), 'doc' => $r->getDocComment() ?: null, 'methods' => []];
    foreach ($r->getMethods() as $m) {
        if ($m->getDeclaringClass()->getName() !== $r->getName()) continue;
        $params = [];
        foreach ($m->getParameters() as $p) {
            $params[] = [
                'name' => $p->getName(),
                'type' => $p->hasType() ? (string) $p->getType() : null,
            ];
        }
        $cls['methods'][] = [
            'name' => $m->getName(),
            'doc' => $m->getDocComment() ?: null,
            'visibility' => $m->isPublic() ? 'public' : ($m->isProtected() ? 'protected' : 'private'),
            'static' => $m->isStatic(),
            'returnType' => $m->hasReturnType() ? (string) $m->getReturnType() : null,
            'params' => $params,
        ];
    }
    $out[] = $cls;
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);`;

export const registerGeneratePhpdocTool = (server: McpServer): void => {
  server.registerTool(
    GENERATE_PHPDOC_TOOL,
    {
      title: 'Generate PHPDoc',
      description:
        "Bir PHP dosyasındaki sınıf ve metotlar için eksik PHPDoc bloklarını raporlar.",
      inputSchema: z.object({
        filepath: z.string().min(1).describe('Hedef dosya. Örnek: ./src/Foo.php')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filepath }) => {
      logger.debug('tool.call', { tool: GENERATE_PHPDOC_TOOL, filepath });

      const normalised = safeNormalisePath(filepath);
      if (!normalised.ok) {
        return normalised.response;
      }
      const target = normalised.path;

      try {
        const info = await stat(target);
        if (!info.isFile()) {
          return errorResult(`Yol bir dosyaya işaret etmiyor: ${target}`);
        }
      } catch (err) {
        return errorResult(`Dosya okunamadı: ${target}\nSebep: ${formatUnknown(err)}`);
      }

      try {
        const result = await runCommand(PHP_BIN, ['-r', PHPDOC_QUERY, '--', target], {
          timeoutMs: DEFAULT_EXEC_TIMEOUT_MS
        });
        let parsed: Array<{
          name: string;
          doc: string | null;
          methods: Array<{
            name: string;
            doc: string | null;
            visibility: string;
            static: boolean;
            returnType: string | null;
            params: Array<{ name: string; type: string | null }>;
          }>;
        }>;
        try {
          parsed = JSON.parse(result.stdout);
        } catch {
          return textResult(`PHPDoc analizi başarısız. Ham çıktı:\n\n${result.stdout}`);
        }
        const suggestions: string[] = [];
        for (const cls of parsed) {
          if (!cls.doc) {
            suggestions.push(`Class ${cls.name} — class-level PHPDoc eksik.`);
          }
          for (const m of cls.methods) {
            if (m.name === '__construct' || m.name.startsWith('__')) {
              continue;
            }
            if (m.doc) {
              continue;
            }
            const lines = ['/**'];
            if (m.params.length > 0) {
              for (const p of m.params) {
                const t = p.type ?? 'mixed';
                lines.push(` * @param ${t} $${p.name}`);
              }
            }
            if (m.returnType) {
              lines.push(` * @return ${m.returnType}`);
            }
            lines.push(' */');
            suggestions.push(
              `${m.visibility}${m.static ? ' static' : ''} ${m.name}() — eksik PHPDoc:\n  ${lines.join('\n  ')}`
            );
          }
        }

        if (suggestions.length === 0) {
          return textResult(`✅ Tüm sınıf ve metotların PHPDoc'u eksiksiz: ${target}`);
        }
        return textResult(
          `🔍 ${suggestions.length} eksik PHPDoc bulundu (${target}):\n\n${suggestions.map((s) => '- ' + s).join('\n\n')}\n\nNot: Otomatik ekleme için Rector (AddPhpDocFromNativeTypeRule) kullanın.`
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return errorResult(PHP_MISSING_HINT);
        }
        if (err instanceof ExecError) {
          return errorResult(
            `PHPDoc analizi başarısız (exit ${err.exitCode}):\n\n${err.stderr.trim() || err.stdout.trim()}`
          );
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// suggest_refactoring
// ──────────────────────────────────────────────────────────────────────

export const SUGGEST_REFACTORING_TOOL = 'suggest_refactoring';

interface RefactorFinding {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly severity: 'low' | 'medium' | 'high';
  readonly message: string;
}

const LONG_METHOD_LINES = 60;
const LARGE_CLASS_LINES = 800;
const DEEP_NESTING = 4;

const collectFindings = async (root: string): Promise<{ findings: RefactorFinding[]; files: number }> => {
  const { scanFiles } = await import('../utils/file-scanner.js');
  const scan = await scanFiles({ root, onlyPhp: true, maxBytes: 32 * 1024 * 1024 });
  const findings: RefactorFinding[] = [];

  for (const file of scan.files) {
    const lines = file.content.split('\n');
    let inFunction: { name: string; braceDepth: number; startLine: number } | null = null;
    let className: string | null = null;
    let classStartLine = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const lineNumber = i + 1;
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;

      const classMatch = line.match(/(?:abstract\s+|final\s+)?(?:class|trait|interface)\s+([A-Z]\w+)/);
      if (classMatch && classMatch[1] && className === null) {
        className = classMatch[1];
        classStartLine = lineNumber;
      }
      if (line.match(/^\s*\}/) && className && lineNumber - classStartLine > LARGE_CLASS_LINES) {
        findings.push({
          id: 'large_class',
          file: file.relative,
          line: classStartLine,
          severity: 'medium',
          message: `Sınıf '${className}' ${lineNumber - classStartLine} satır — god class şüphesi.`
        });
        className = null;
      }

      const fnMatch = line.match(/(?:public|private|protected|static|\s)*\s+function\s+&?(\w+)\s*\(/);
      if (fnMatch && fnMatch[1] && !inFunction) {
        inFunction = { name: fnMatch[1], braceDepth: 0, startLine: lineNumber };
      }

      if (inFunction) {
        inFunction.braceDepth += opens - closes;
        if (inFunction.braceDepth <= 0 && (opens > 0 || closes > 0)) {
          const length = lineNumber - inFunction.startLine + 1;
          if (length > LONG_METHOD_LINES) {
            findings.push({
              id: 'long_method',
              file: file.relative,
              line: inFunction.startLine,
              severity: length > LONG_METHOD_LINES * 2 ? 'high' : 'medium',
              message: `Metod '${inFunction.name}' ${length} satır — bölüp private helper'lara ayırmayı düşünün.`
            });
          }
          inFunction = null;
        }
        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        const level = Math.floor(indent / 4);
        if (level > DEEP_NESTING && /\bif\b|\bfor\b|\bforeach\b|\bwhile\b/.test(line)) {
          findings.push({
            id: 'deep_nesting',
            file: file.relative,
            line: lineNumber,
            severity: 'low',
            message: `Derin iç içe geçmiş kontrol yapısı (seviye ${level}). Early-return ile düzleştirilebilir.`
          });
        }
      }

      if (line.includes('eval(')) {
        findings.push({
          id: 'eval_usage',
          file: file.relative,
          line: lineNumber,
          severity: 'high',
          message: 'eval() kullanımı — refactor önerilir.'
        });
      }
    }
  }

  return { findings, files: scan.files.length };
};

export const registerSuggestRefactoringTool = (server: McpServer): void => {
  server.registerTool(
    SUGGEST_REFACTORING_TOOL,
    {
      title: 'Suggest Refactoring',
      description:
        "Uzun metod, god class, derin iç içe geçmiş kontrol yapıları ve kötü kokular için heuristik öneriler üretir.",
      inputSchema: z.object({
        path: z.string().optional().describe('Taranacak dizin veya dosya. Belirtilmezse proje kökü.'),
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
      logger.debug('tool.call', { tool: SUGGEST_REFACTORING_TOOL, path });

      const ws = resolveProjectRoot(projectPath);
      let resolvedRoot = ws.root;
      if (path) {
        const norm = safeNormalisePath(path);
        if (!norm.ok) {
          return norm.response;
        }
        resolvedRoot = norm.path;
      }
      if (!existsSync(resolvedRoot)) {
        return errorResult(`Yol taranabilir değil: ${resolvedRoot}`);
      }

      try {
        const { findings, files } = await collectFindings(resolvedRoot);
        if (findings.length === 0) {
          return textResult(`✅ Refactoring önerisi yok (${files} PHP dosyası tarandı).`);
        }
        const header = `🔍 ${findings.length} refactoring önerisi (${files} dosya tarandı):`;
        const lines = findings.map(
          (f) => `- [${f.severity.toUpperCase()}] ${f.file}:${f.line}  ${f.message}`
        );
        return textResult([header, '', ...lines].join('\n'));
      } catch (err) {
        return errorResult(`Refactoring taraması başarısız: ${formatUnknown(err)}`);
      }
    }
  );
};
