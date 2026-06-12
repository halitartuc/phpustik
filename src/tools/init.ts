/**
 * `phpustik_init` — bootstrap a PHP project with optimal config files.
 *
 * Detects the framework, PHP version, and existing tooling, then
 * generates the missing config files:
 *
 *   - phpstan.neon (with level-based rules)
 *   - psalm.xml
 *   - .php-cs-fixer.php (PSR-12)
 *   - rector.php (with the project's target PHP version)
 *   - phpmd.xml
 *   - phpcs.xml
 *   - phpunit.xml
 *   - .editorconfig
 *   - .gitattributes
 *   - .github/workflows/ci.yml
 *   - bin/pre-commit (executable shell script)
 *
 * All templates are hand-tuned for low false-positive rate and modern
 * PHP best-practices (declare(strict_types=1), readonly, etc.).
 *
 * Modes:
 *   - dryRun (default true): show a unified diff without writing
 *   - apply: write all generated files to disk
 *   - only: subset of config files (comma-separated)
 *   - force: overwrite existing files
 */

import * as z from 'zod/v4';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  errorResult,
  formatUnknown,
  resolveProjectRoot,
  textResult,
  type ToolResponse
} from '../utils/responses.js';
import { logger } from '../utils/logger.js';
import { detectFramework } from '../utils/framework-detector.js';
import { readComposerJson, readPhpVersion } from '../utils/workspace.js';
import { PHPSTAN_LEVELS, type PhpStanLevel, PSALM_LEVELS, type PsalmLevel } from '../constants.js';
import { progress as emitProgress, mcpLog } from '../utils/notification-sink.js';
import {
  buildProjectName,
  generateEditorConfig,
  generateGitAttributes,
  generateGitHubActionsCi,
  generatePhpcsConfig,
  generatePhpCsFixerConfig,
  generatePhpmdConfig,
  generatePhpstanConfig,
  generatePhpunitConfig,
  generatePreCommit,
  generatePsalmConfig,
  generateRectorConfig
} from '../utils/config-templates.js';

export const INIT_TOOL = 'phpustik_init';

const ALL_FILES = [
  'phpstan.neon',
  'psalm.xml',
  '.php-cs-fixer.php',
  'rector.php',
  'phpmd.xml',
  'phpcs.xml',
  'phpunit.xml',
  '.editorconfig',
  '.gitattributes',
  '.github/workflows/ci.yml',
  'bin/pre-commit'
] as const;

type ConfigFile = (typeof ALL_FILES)[number];

const ALL_FILE_SET = new Set<string>(ALL_FILES);

const isConfigFile = (name: string): name is ConfigFile => ALL_FILE_SET.has(name);

interface FileAction {
  readonly path: string;
  readonly display: string;
  readonly status: 'create' | 'overwrite' | 'keep';
  readonly contents: string;
}

const renderUnifiedDiff = (label: string, existing: string | null, generated: string): string => {
  if (existing === null) {
    return `+++ ${label} (new)\n${generated.split('\n').map((l) => `+ ${l}`).join('\n')}`;
  }
  if (existing === generated) {
    return `(no diff for ${label})`;
  }
  const a = existing.split('\n');
  const b = generated.split('\n');
  const max = Math.max(a.length, b.length);
  const out: string[] = [`@@ ${label} (modified) @@`];
  for (let i = 0; i < max; i += 1) {
    const al = a[i];
    const bl = b[i];
    if (al === bl) {
      if (al !== undefined) {
        out.push(`  ${al}`);
      }
    } else {
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

const buildFile = (
  root: string,
  relPath: string,
  contents: string,
  executable: boolean
): FileAction => {
  const fullPath = join(root, relPath);
  const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : null;
  let status: FileAction['status'];
  if (existing === null) {
    status = 'create';
  } else if (existing === contents) {
    status = 'keep';
  } else {
    status = 'overwrite';
  }
  void executable;
  return {
    path: fullPath,
    display: relPath,
    status,
    contents
  };
};

const applyActions = (actions: readonly FileAction[], executableFiles: ReadonlySet<string>): void => {
  for (const a of actions) {
    if (a.status === 'keep') {
      continue;
    }
    writeFileSync(a.path, a.contents, 'utf8');
    if (executableFiles.has(a.display)) {
      try {
        chmodSync(a.path, 0o755);
      } catch {
        // Windows doesn't support chmod the same way; ignore.
      }
    }
  }
};

const renderReport = (
  actions: readonly FileAction[],
  projectRoot: string,
  framework: string,
  phpVersion: string | null,
  phpstanLevel: PhpStanLevel,
  psalmLevel: PsalmLevel
): { markdown: string; structured: Record<string, unknown> } => {
  const created = actions.filter((a) => a.status === 'create');
  const overwritten = actions.filter((a) => a.status === 'overwrite');
  const kept = actions.filter((a) => a.status === 'keep');

  const md: string[] = [];
  md.push(`# 🛠 phpustik init — önizleme`);
  md.push('');
  md.push(`**Proje**: \`${projectRoot}\``);
  md.push(`**Framework**: ${framework}`);
  md.push(`**Hedef PHP**: ${phpVersion ?? "(composer.json'dan okunacak)"}`);
  md.push(`**PHPStan seviyesi**: ${phpstanLevel}`);
  md.push(`**Psalm seviyesi**: ${psalmLevel}`);
  md.push('');
  md.push('## Üretilecek / üzerine yazılacak dosyalar');
  md.push('');
  for (const a of actions) {
    const icon = a.status === 'create' ? '🆕' : a.status === 'overwrite' ? '♻️ ' : '✓ ';
    const suffix =
      a.status === 'create'
        ? '(yeni)'
        : a.status === 'overwrite'
          ? '(üzerine yazılacak)'
          : '(zaten güncel)';
    md.push(`- ${icon} \`${a.display}\` ${suffix}`);
  }
  md.push('');
  md.push(`**Özet**: ${created.length} yeni, ${overwritten.length} güncellenecek, ${kept.length} zaten güncel.`);
  md.push('');

  if (overwritten.length > 0) {
    md.push('## Değişecek dosyaların diff önizlemesi');
    md.push('');
    for (const a of overwritten) {
      const existing = readFileSync(a.path, 'utf8');
      md.push('```diff');
      md.push(renderUnifiedDiff(a.display, existing, a.contents));
      md.push('```');
      md.push('');
    }
  }

  const structured = {
    projectRoot,
    framework,
    phpVersion,
    phpstanLevel,
    psalmLevel,
    totals: {
      create: created.length,
      overwrite: overwritten.length,
      keep: kept.length
    },
    actions: actions.map((a) => ({
      path: a.display,
      status: a.status
    }))
  };

  return { markdown: md.join('\n'), structured };
};

export const registerInitTool = (server: McpServer): void => {
  server.registerTool(
    INIT_TOOL,
    {
      title: 'Bootstrap PHP project config',
      description:
        "Bir PHP projesi için optimal config dosyalarını üretir: phpstan.neon, psalm.xml, .php-cs-fixer.php, rector.php, phpunit.xml, phpmd.xml, phpcs.xml, .editorconfig, .gitattributes, .github/workflows/ci.yml, bin/pre-commit.",
      inputSchema: z.object({
        dryRun: z
          .boolean()
          .default(true)
          .describe('Sadece önizleme (default). apply=true ile dosyalara yaz. Varsayılan: true.'),
        force: z
          .boolean()
          .default(false)
          .describe('Mevcut dosyaların üzerine yaz. Varsayılan: false (üzerine yazmaz).'),
        only: z
          .string()
          .optional()
          .describe('Sadece belirli dosyaları üret (virgülle ayrılmış). Boş = hepsi. Örnek: phpstan.neon,phpunit.xml'),
        phpstanLevel: z
          .enum(PHPSTAN_LEVELS)
          .default('5')
          .describe('phpstan.neon için seviye. Varsayılan: 5 (orta).'),
        psalmLevel: z
          .enum(PSALM_LEVELS)
          .default('4')
          .describe('psalm.xml için seviye. Varsayılan: 4.'),
        phpVersions: z
          .string()
          .default('8.1,8.2,8.3,8.4')
          .describe('CI matrisinde test edilecek PHP sürümleri (virgülle). Varsayılan: 8.1,8.2,8.3,8.4.'),
        projectPath: z
          .string()
          .optional()
          .describe('Proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (
      { dryRun, force, only, phpstanLevel, psalmLevel, phpVersions, projectPath },
      _ctx: ServerContext
    ): Promise<ToolResponse> => {
      logger.info('tool.call', { tool: INIT_TOOL, dryRun, force, only });

      const ws = resolveProjectRoot(projectPath);
      const composerJson = readComposerJson(ws);
      const composerName = (composerJson?.['name'] as string | undefined) ?? null;
      const phpVersion = readPhpVersion(ws) ?? null;
      const projectName = buildProjectName(composerName, ws.root);
      const framework = detectFramework(ws);
      const isLaravel = framework.id === 'laravel';
      const isSymfony = framework.id === 'symfony';

      const wantedFiles: ConfigFile[] = only
        ? (only
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .filter(isConfigFile))
        : [...ALL_FILES];

      if (only && wantedFiles.length === 0) {
        return errorResult(
          `'only' içinde geçerli dosya adı yok. İzin verilenler: ${ALL_FILES.join(', ')}`
        );
      }

      const executable = new Set<string>(['bin/pre-commit']);
      const actions: FileAction[] = [];
      const matrixVersions = phpVersions
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d+\.\d+$/.test(s));

      let step = 0;
      const total = wantedFiles.length + 1;
      const advance = async (label: string): Promise<void> => {
        step += 1;
        await emitProgress({ current: step, total, message: label });
        await mcpLog('info', `[init] ${label}`);
      };

      const ctx = {
        framework: framework.id,
        phpVersion,
        projectName,
        isLaravel,
        isSymfony,
        isWordPress: framework.id === 'wordpress'
      };

      for (const file of wantedFiles) {
        await advance(`Generating ${file}`);
        let content = '';
        switch (file) {
          case 'phpstan.neon':
            content = generatePhpstanConfig(phpstanLevel, ctx);
            break;
          case 'psalm.xml':
            content = generatePsalmConfig(psalmLevel, ctx);
            break;
          case '.php-cs-fixer.php':
            content = generatePhpCsFixerConfig();
            break;
          case 'rector.php':
            content = generateRectorConfig(ctx);
            break;
          case 'phpmd.xml':
            content = generatePhpmdConfig(projectName);
            break;
          case 'phpcs.xml':
            content = generatePhpcsConfig(isLaravel);
            break;
          case 'phpunit.xml':
            content = generatePhpunitConfig();
            break;
          case '.editorconfig':
            content = generateEditorConfig();
            break;
          case '.gitattributes':
            content = generateGitAttributes();
            break;
          case '.github/workflows/ci.yml':
            content = generateGitHubActionsCi(ctx, matrixVersions.length > 0 ? matrixVersions : ['8.1', '8.2', '8.3']);
            break;
          case 'bin/pre-commit':
            content = generatePreCommit();
            break;
        }
        const action = buildFile(ws.root, file, content, executable.has(file));
        if (action.status === 'overwrite' && !force) {
          actions.push({ ...action, status: 'keep', contents: action.contents });
        } else {
          actions.push(action);
        }
      }

      await mcpLog('info', `[init] Tüm ${actions.length} dosya hazır.`);

      if (!dryRun) {
        applyActions(actions, executable);
        const created = actions.filter((a) => a.status === 'create').length;
        const overwritten = actions.filter((a) => a.status === 'overwrite').length;
        const kept = actions.filter((a) => a.status === 'keep').length;
        const summary = [
          `✅ phpustik init tamamlandı (${relative(process.cwd(), ws.root)}).`,
          '',
          `- 🆕 ${created} yeni dosya`,
          `- ♻️  ${overwritten} üzerine yazıldı`,
          `- ✓  ${kept} zaten güncel`,
          '',
          'Sonraki adım: `phpustik_doctor` çalıştırarak yeni config\'leri doğrula.'
        ].join('\n');
        return textResult(summary, {
          projectRoot: ws.root,
          framework: framework.id,
          phpVersion,
          totals: { create: created, overwrite: overwritten, keep: kept }
        });
      }

      const { markdown, structured } = renderReport(
        actions,
        ws.root,
        framework.display,
        phpVersion,
        phpstanLevel,
        psalmLevel
      );
      return {
        content: [{ type: 'text' as const, text: markdown }],
        structuredContent: structured
      };
    }
  );
};

void errorResult;
void formatUnknown;
