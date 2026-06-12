/**
 * Workspace discovery.
 *
 * The MCP server typically has no idea where the user's project lives.
 * Each tool call would otherwise need its own `project_path` parameter,
 * which is noisy and error-prone.
 *
 * `resolveWorkspace` walks upward from the current working directory
 * (or from an explicit hint) and returns the closest directory that
 * looks like the root of a PHP project. The heuristic is intentionally
 * generous — any of the following count as a project marker:
 *
 *   - composer.json
 *   - composer.lock
 *   - phpstan.neon / phpstan.neon.dist
 *   - psalm.xml / psalm.xml.dist
 *   - .php-cs-fixer.php / .php-cs-fixer.dist.php
 *   - phpmd.xml / phpmd.xml.dist
 *   - phpcs.xml / phpcs.xml.dist
 *   - rector.php / rector.yaml
 *   - phpunit.xml / phpunit.xml.dist
 *   - .php-version
 *   - artisan (Laravel)
 *   - symfony.lock / bin/console (Symfony)
 *
 * The function also exposes targeted getters (composerJsonPath, etc.)
 * that compose the same walk-up logic with a known file name.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const PROJECT_MARKERS = [
  'composer.json',
  'composer.lock',
  'phpstan.neon',
  'phpstan.neon.dist',
  'psalm.xml',
  'psalm.xml.dist',
  '.php-cs-fixer.php',
  '.php-cs-fixer.dist.php',
  'phpmd.xml',
  'phpmd.xml.dist',
  'phpcs.xml',
  'phpcs.xml.dist',
  'rector.php',
  'rector.yaml',
  'rector.yml',
  'phpunit.xml',
  'phpunit.xml.dist',
  '.php-version',
  'artisan',
  'symfony.lock'
];

void homedir;
void resolve;

export interface WorkspaceContext {
  readonly root: string;
  readonly composerJson: string | null;
  readonly composerLock: string | null;
  readonly phpVersionFile: string | null;
  readonly phpstanConfig: string | null;
  readonly psalmConfig: string | null;
  readonly phpCsFixerConfig: string | null;
  readonly phpunitConfig: string | null;
  readonly rectorConfig: string | null;
  readonly phpMdConfig: string | null;
  readonly phpcsConfig: string | null;
  readonly isLaravel: boolean;
  readonly isSymfony: boolean;
}

const stopPath = (start: string): string => {
  if (process.platform !== 'win32') {
    return resolve('/');
  }
  const match = start.match(/^([a-zA-Z]:)[\\/]?/);
  return match ? `${match[1]}\\` : start;
};

const walkUp = (start: string, predicate: (dir: string) => boolean): string | null => {
  let current = resolve(start);
  const stop = stopPath(current);

  while (true) {
    if (predicate(current)) {
      return current;
    }
    if (current === stop) {
      return null;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};

const findMarker = (start: string, file: string): string | null => {
  const found = walkUp(start, (dir) => existsSync(join(dir, file)));
  return found ? join(found, file) : null;
};

const findComposerJson = (start: string): string | null => findMarker(start, 'composer.json');
const findComposerLock = (start: string): string | null => findMarker(start, 'composer.lock');
const findPhpVersion = (start: string): string | null => findMarker(start, '.php-version');

const findConfig = (start: string, names: readonly string[]): string | null => {
  for (const name of names) {
    const hit = findMarker(start, name);
    if (hit) {
      return hit;
    }
  }
  return null;
};

export const findProjectRoot = (start?: string): string | null => {
  const origin = start ? resolve(start) : process.cwd();
  return walkUp(origin, (dir) => PROJECT_MARKERS.some((m) => existsSync(join(dir, m))));
};

export const resolveWorkspace = (hint?: string): WorkspaceContext => {
  const origin = hint ? resolve(hint) : process.cwd();
  const root = findProjectRoot(origin) ?? origin;
  const composerJson = findComposerJson(root);

  return {
    root,
    composerJson,
    composerLock: findComposerLock(root),
    phpVersionFile: findPhpVersion(root),
    phpstanConfig: findConfig(root, ['phpstan.neon', 'phpstan.neon.dist']),
    psalmConfig: findConfig(root, ['psalm.xml', 'psalm.xml.dist']),
    phpCsFixerConfig: findConfig(root, ['.php-cs-fixer.php', '.php-cs-fixer.dist.php']),
    phpunitConfig: findConfig(root, [
      'phpunit.xml',
      'phpunit.xml.dist',
      'phpunit.dist.xml'
    ]),
    rectorConfig: findConfig(root, ['rector.php', 'rector.yaml', 'rector.yml']),
    phpMdConfig: findConfig(root, ['phpmd.xml', 'phpmd.xml.dist']),
    phpcsConfig: findConfig(root, ['phpcs.xml', 'phpcs.xml.dist']),
    isLaravel: existsSync(join(root, 'artisan')) && existsSync(join(root, 'bootstrap')),
    isSymfony:
      existsSync(join(root, 'symfony.lock')) || existsSync(join(root, 'bin', 'console'))
  };
};

export const readPhpVersion = (workspace: WorkspaceContext): string | null => {
  if (!workspace.phpVersionFile) {
    return null;
  }
  try {
    return readFileSync(workspace.phpVersionFile, 'utf8').trim();
  } catch {
    return null;
  }
};

export const readComposerJson = (workspace: WorkspaceContext): Record<string, unknown> | null => {
  if (!workspace.composerJson) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(workspace.composerJson, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const formatPath = (absolute: string): string => absolute.split(sep).join('/');

export const describeWorkspace = (ws: WorkspaceContext): string => {
  const lines = [
    `Project root: ${formatPath(ws.root)}`,
    ws.composerJson ? `composer.json: ${formatPath(ws.composerJson)}` : 'composer.json: (not found)',
    ws.phpVersionFile
      ? `.php-version: ${formatPath(ws.phpVersionFile)} (${readPhpVersion(ws) ?? '?'})`
      : '.php-version: (not found)',
    ws.phpstanConfig ? `PHPStan: ${formatPath(ws.phpstanConfig)}` : null,
    ws.psalmConfig ? `Psalm: ${formatPath(ws.psalmConfig)}` : null,
    ws.phpCsFixerConfig ? `PHP-CS-Fixer: ${formatPath(ws.phpCsFixerConfig)}` : null,
    ws.phpunitConfig ? `PHPUnit: ${formatPath(ws.phpunitConfig)}` : null,
    ws.rectorConfig ? `Rector: ${formatPath(ws.rectorConfig)}` : null,
    ws.phpMdConfig ? `PHPMD: ${formatPath(ws.phpMdConfig)}` : null,
    ws.phpcsConfig ? `PHPCS: ${formatPath(ws.phpcsConfig)}` : null,
    `Framework: ${ws.isLaravel ? 'Laravel' : ws.isSymfony ? 'Symfony' : '(unknown)'}`
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
};
