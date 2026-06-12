/**
 * MCP Resources.
 *
 * Resources are server-side artefacts the model can `read` to enrich its
 * context. The URI scheme is `phpustik://` for project-aware data and
 * `php://` for raw PHP runtime data.
 *
 *   phpustik://workspace       → project summary
 *   phpustik://composer-json   → composer.json
 *   phpustik://php-version     → .php-version
 *   phpustik://framework       → detected framework
 *   php://info                 → php -i (curated)
 *   php://extensions           → php -m
 *   php://ini-loaded           → loaded ini files
 *
 * Resources are read-only and never require arguments.
 */

import type { McpServer, ReadResourceCallback } from '@modelcontextprotocol/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHP_BIN, PHP_MISSING_HINT } from './constants.js';
import { resolveWorkspace, describeWorkspace, readComposerJson, readPhpVersion } from './utils/workspace.js';
import { detectFramework } from './utils/framework-detector.js';
import { runCommand } from './utils/executor.js';
import { logger } from './utils/logger.js';

const text = (uri: string, body: string, mimeType = 'text/plain') => ({
  contents: [{ uri, text: body, mimeType }]
});

const wrap =
  (handler: (uri: URL) => Promise<{ contents: Array<{ uri: string; text: string; mimeType?: string }> }>) =>
  (uri: URL): ReturnType<ReadResourceCallback> => {
    try {
      const result = handler(uri);
      return result as unknown as ReturnType<ReadResourceCallback>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('resource.error', { uri: uri.href, message });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Resource okunamadı (${uri.href}): ${message}`
          }
        ]
      } as unknown as ReturnType<ReadResourceCallback>;
    }
  };

export const registerAllResources = (server: McpServer): void => {
  // phpustik://workspace
  server.registerResource(
    'phpustik-workspace',
    'phpustik://workspace',
    { title: 'PHP Workspace Summary', description: 'Aktif PHP projesinin özeti (root, framework, config dosyaları).' },
    wrap(async (uri) => {
      const ws = resolveWorkspace();
      return text(uri.href, describeWorkspace(ws));
    })
  );

  // phpustik://composer-json
  server.registerResource(
    'phpustik-composer-json',
    'phpustik://composer-json',
    {
      title: 'composer.json',
      description: "Aktif projenin composer.json içeriği (yoksa 'composer.json bulunamadı').",
      mimeType: 'application/json'
    },
    wrap(async (uri) => {
      const ws = resolveWorkspace();
      if (!ws.composerJson) {
        return text(uri.href, 'composer.json bulunamadı.', 'application/json');
      }
      return text(uri.href, readFileSync(ws.composerJson, 'utf8'), 'application/json');
    })
  );

  // phpustik://php-version
  server.registerResource(
    'phpustik-php-version',
    'phpustik://php-version',
    { title: 'Target PHP version', description: '`.php-version` dosyasının içeriği (yoksa boş).' },
    wrap(async (uri) => {
      const ws = resolveWorkspace();
      const v = readPhpVersion(ws) ?? '';
      return text(uri.href, v);
    })
  );

  // phpustik://framework
  server.registerResource(
    'phpustik-framework',
    'phpustik://framework',
    { title: 'Detected framework', description: 'Aktif proje için tespit edilen framework ve sürümü.', mimeType: 'application/json' },
    wrap(async (uri) => {
      const ws = resolveWorkspace();
      const sig = detectFramework(ws);
      return text(uri.href, JSON.stringify(sig, null, 2), 'application/json');
    })
  );

  // phpustik://composer-extra
  server.registerResource(
    'phpustik-composer-extra',
    'phpustik://composer-extra',
    {
      title: 'composer.json extras block',
      description: 'composer.json içindeki `extra` alanı (framework-specific metadata barındırır).',
      mimeType: 'application/json'
    },
    wrap(async (uri) => {
      const ws = resolveWorkspace();
      const data = readComposerJson(ws);
      const extra = (data && typeof data === 'object' ? (data as Record<string, unknown>)['extra'] : null) ?? {};
      return text(uri.href, JSON.stringify(extra, null, 2), 'application/json');
    })
  );

  // php://info
  server.registerResource(
    'php-info',
    'php://info',
    { title: 'php -i (curated)', description: "PHP'nin 'php -i' çıktısının ana bölümleri (ilk 200 satır)." },
    wrap(async (uri) => {
      try {
        const result = await runCommand(PHP_BIN, ['-i'], { timeoutMs: 10_000 });
        const lines = result.stdout.split('\n').slice(0, 200);
        return text(uri.href, lines.join('\n'));
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return text(uri.href, PHP_MISSING_HINT);
        }
        throw err;
      }
    })
  );

  // php://extensions
  server.registerResource(
    'php-extensions',
    'php://extensions',
    { title: 'Loaded PHP extensions', description: "`php -m` çıktısı (yüklü eklentilerin listesi).", mimeType: 'text/plain' },
    wrap(async (uri) => {
      try {
        const result = await runCommand(PHP_BIN, ['-m'], { timeoutMs: 5_000 });
        return text(uri.href, result.stdout);
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return text(uri.href, PHP_MISSING_HINT);
        }
        throw err;
      }
    })
  );

  // php://ini-loaded
  server.registerResource(
    'php-ini-loaded',
    'php://ini-loaded',
    { title: 'Loaded ini files', description: 'Yüklü php.ini ve ek `.ini` dosyalarının listesi.' },
    wrap(async (uri) => {
      const ws = resolveWorkspace();
      const candidates = [
        'php.ini',
        'php.ini-production',
        'conf.d/opcache.ini',
        'conf.d/pdo.ini',
        'conf.d/curl.ini',
        'conf.d/mbstring.ini'
      ];
      const found: string[] = [];
      for (const c of candidates) {
        if (existsSync(c)) {
          found.push(c);
        }
      }
      const projectInis: string[] = [];
      if (existsSync(join(ws.root, 'php.ini'))) {
        projectInis.push(join(ws.root, 'php.ini'));
      }
      return text(uri.href, JSON.stringify({ system: found, project: projectInis }, null, 2), 'application/json');
    })
  );
};
