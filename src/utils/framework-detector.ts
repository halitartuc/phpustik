/**
 * Framework detection.
 *
 * Heuristic, file-system based detection of the PHP framework(s) used in
 * the current project. Works against a `WorkspaceContext` produced by
 * `utils/workspace.ts`.
 *
 * Detection order is by confidence: the strongest signal wins.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameworkName } from '../constants.js';
import type { WorkspaceContext } from './workspace.js';

export interface FrameworkSignature {
  readonly id: FrameworkName;
  readonly display: string;
  readonly version?: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly evidence: readonly string[];
}

const composerRequiresFramework = (
  ws: WorkspaceContext,
  packageName: string
): string | null => {
  if (!ws.composerJson) {
    return null;
  }
  try {
    const composer = JSON.parse(readFileSync(ws.composerJson, 'utf8')) as {
      require?: Record<string, string>;
      'require-dev'?: Record<string, string>;
    };
    const merged = { ...(composer.require ?? {}), ...(composer['require-dev'] ?? {}) };
    return merged[packageName] ?? null;
  } catch {
    return null;
  }
};

const composerVersion = (ws: WorkspaceContext, packageName: string): string | null => {
  const constraint = composerRequiresFramework(ws, packageName);
  if (!constraint) {
    return null;
  }
  // strip operators: ^1.2.3, ~1.2, >=2.0 → 1.2.3 etc.
  return constraint.replace(/^[\^~>=<*\s]+/, '').trim() || null;
};

const fileExists = (root: string, ...parts: string[]): boolean =>
  existsSync(join(root, ...parts));

export const detectFramework = (ws: WorkspaceContext): FrameworkSignature => {
  const evidence: string[] = [];
  let candidate: FrameworkName = 'unknown';

  if (fileExists(ws.root, 'artisan') && fileExists(ws.root, 'bootstrap', 'app.php')) {
    candidate = 'laravel';
    evidence.push('artisan + bootstrap/app.php', 'laravel/framework require');
  } else if (fileExists(ws.root, 'symfony.lock') || fileExists(ws.root, 'bin', 'console')) {
    candidate = 'symfony';
    evidence.push('symfony.lock or bin/console');
  } else if (composerRequiresFramework(ws, 'laravel/framework')) {
    candidate = 'laravel';
    evidence.push('composer requires laravel/framework');
  } else if (
    composerRequiresFramework(ws, 'symfony/framework-bundle') ||
    composerRequiresFramework(ws, 'symfony/symfony')
  ) {
    candidate = 'symfony';
    evidence.push('composer requires symfony/framework-bundle');
  } else if (fileExists(ws.root, 'wp-config.php') || fileExists(ws.root, 'wp-load.php')) {
    candidate = 'wordpress';
    evidence.push('wp-config.php or wp-load.php');
  } else if (composerRequiresFramework(ws, 'johnpbloch/wordpress-core')) {
    candidate = 'wordpress';
    evidence.push('composer requires johnpbloch/wordpress-core');
  } else if (composerRequiresFramework(ws, 'codeigniter4/framework')) {
    candidate = 'codeigniter';
    evidence.push('composer requires codeigniter4/framework');
  } else if (composerRequiresFramework(ws, 'yiisoft/yii2')) {
    candidate = 'yii';
    evidence.push('composer requires yiisoft/yii2');
  } else if (composerRequiresFramework(ws, 'slim/slim')) {
    candidate = 'slim';
    evidence.push('composer requires slim/slim');
  } else if (composerRequiresFramework(ws, 'laminas/laminas-mvc')) {
    candidate = 'laminas';
    evidence.push('composer requires laminas/laminas-mvc');
  } else if (composerRequiresFramework(ws, 'phalcon/phalcon')) {
    candidate = 'phalcon';
    evidence.push('composer requires phalcon/phalcon');
  } else if (composerRequiresFramework(ws, 'cakephp/cakephp')) {
    candidate = 'cake';
    evidence.push('composer requires cakephp/cakephp');
  }

  const versionMap: Record<FrameworkName, string | null> = {
    laravel: composerVersion(ws, 'laravel/framework'),
    symfony: composerVersion(ws, 'symfony/framework-bundle'),
    wordpress: composerVersion(ws, 'johnpbloch/wordpress-core'),
    codeigniter: composerVersion(ws, 'codeigniter4/framework'),
    yii: composerVersion(ws, 'yiisoft/yii2'),
    slim: composerVersion(ws, 'slim/slim'),
    laminas: composerVersion(ws, 'laminas/laminas-mvc'),
    phalcon: composerVersion(ws, 'phalcon/phalcon'),
    cake: composerVersion(ws, 'cakephp/cakephp'),
    'php-cms': null,
    unknown: null
  };

  const displayMap: Record<FrameworkName, string> = {
    laravel: 'Laravel',
    symfony: 'Symfony',
    wordpress: 'WordPress',
    codeigniter: 'CodeIgniter',
    yii: 'Yii',
    slim: 'Slim',
    laminas: 'Laminas',
    phalcon: 'Phalcon',
    cake: 'CakePHP',
    'php-cms': 'PHP CMS',
    unknown: 'Unknown / Plain PHP'
  };

  const confidence: FrameworkSignature['confidence'] =
    candidate === 'unknown' ? 'low' : evidence.length > 1 ? 'high' : 'medium';

  return {
    id: candidate,
    display: displayMap[candidate],
    version: versionMap[candidate] ?? undefined,
    confidence,
    evidence
  };
};
