/**
 * Framework detection and framework-specific tools.
 *
 *   - detect_framework
 *   - laravel_artisan
 *   - laravel_routes
 *   - laravel_migrations
 *   - symfony_console
 *   - symfony_container
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHP_BIN, PHP_MISSING_HINT, DEFAULT_EXEC_TIMEOUT_MS } from '../constants.js';
import { logger } from '../utils/logger.js';
import { ExecError, runCommand } from '../utils/executor.js';
import {
  errorResult,
  formatUnknown,
  resolveProjectRoot,
  textResult
} from '../utils/responses.js';
import { detectFramework } from '../utils/framework-detector.js';

// ──────────────────────────────────────────────────────────────────────
// detect_framework
// ──────────────────────────────────────────────────────────────────────

export const DETECT_FRAMEWORK_TOOL = 'detect_framework';

export const registerDetectFrameworkTool = (server: McpServer): void => {
  server.registerTool(
    DETECT_FRAMEWORK_TOOL,
    {
      title: 'Detect PHP Framework',
      description:
        "Proje kökünü analiz ederek kullanılan PHP framework'ünü tespit eder (Laravel, Symfony, WordPress, vb.).",
      inputSchema: z.object({
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ projectPath }) => {
      logger.debug('tool.call', { tool: DETECT_FRAMEWORK_TOOL });
      const ws = resolveProjectRoot(projectPath);
      const sig = detectFramework(ws);
      const lines = [
        `## Framework: ${sig.display}`,
        `**Sürüm**: ${sig.version ?? '(bilinmiyor)'}`,
        `**Güven**: ${sig.confidence}`,
        '',
        '**Kanıtlar**:',
        ...sig.evidence.map((e) => `- ${e}`)
      ];
      return textResult(lines.join('\n'));
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// laravel_artisan
// ──────────────────────────────────────────────────────────────────────

export const LARAVEL_ARTISAN_TOOL = 'laravel_artisan';

export const registerLaravelArtisanTool = (server: McpServer): void => {
  server.registerTool(
    LARAVEL_ARTISAN_TOOL,
    {
      title: 'Laravel Artisan',
      description: "Laravel artisan komutlarını çalıştırır. Yalnızca Laravel projelerinde kullanın.",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .describe("Artisan komutu. 'list', 'migrate:status', 'route:list', 'config:show app' vb."),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ command, projectPath }) => {
      logger.debug('tool.call', { tool: LARAVEL_ARTISAN_TOOL, command });

      const ws = resolveProjectRoot(projectPath);
      if (!existsSync(join(ws.root, 'artisan'))) {
        return errorResult('Bu proje bir Laravel projesi değil (artisan yok).');
      }
      const args = ['artisan', ...command.split(/\s+/).filter((s) => s.length > 0), '--no-interaction'];

      try {
        const result = await runCommand(PHP_BIN, args, {
          cwd: ws.root,
          timeoutMs: DEFAULT_EXEC_TIMEOUT_MS
        });
        const clean = stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
        return textResult(clean.length > 0 ? clean : '(boş çıktı)');
      } catch (err) {
        if (err instanceof ExecError) {
          return textResult(
            stripAnsi(err.stdout + (err.stderr ? '\n' + err.stderr : '')).trim() ||
              'Komut başarısız.'
          );
        }
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return errorResult(PHP_MISSING_HINT);
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

// ──────────────────────────────────────────────────────────────────────
// laravel_routes
// ──────────────────────────────────────────────────────────────────────

export const LARAVEL_ROUTES_TOOL = 'laravel_routes';

const ROUTE_QUERY = `<?php
chdir($argv[1]);
$app = require_once 'bootstrap/app.php';
$kernel = $app->make(Illuminate\\Contracts\\Console\\Kernel::class);
$kernel->bootstrap();
$routes = $app['router']->getRoutes();
$rows = [];
foreach ($routes as $r) {
    $rows[] = [
        'method' => implode('|', $r->methods()),
        'uri' => $r->uri(),
        'name' => $r->getName(),
        'action' => $r->getActionName(),
        'middleware' => implode(',', $r->gatherMiddleware()),
    ];
}
echo json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);`;

export const registerLaravelRoutesTool = (server: McpServer): void => {
  server.registerTool(
    LARAVEL_ROUTES_TOOL,
    {
      title: 'Laravel Routes',
      description: "Laravel uygulamasının tüm route'larını method, uri, name, action, middleware ile listeler.",
      inputSchema: z.object({
        method: z.string().optional().describe('Filtre: GET, POST vb. (opsiyonel).'),
        name: z.string().optional().describe('Filtre: route adında ara (opsiyonel).'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ method, name, projectPath }) => {
      logger.debug('tool.call', { tool: LARAVEL_ROUTES_TOOL });
      const ws = resolveProjectRoot(projectPath);
      if (!existsSync(join(ws.root, 'artisan'))) {
        return errorResult('Bu proje bir Laravel projesi değil (artisan yok).');
      }
      try {
        const result = await runCommand(PHP_BIN, ['-r', ROUTE_QUERY, '--', ws.root], {
          cwd: ws.root,
          timeoutMs: 15_000
        });
        let rows: Array<{
          method: string;
          uri: string;
          name: string | null;
          action: string;
          middleware: string;
        }> = [];
        try {
          rows = JSON.parse(result.stdout);
        } catch {
          return textResult(stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim());
        }
        let filtered = rows;
        if (method) {
          const m = method.toUpperCase();
          filtered = filtered.filter((r) => r.method.toUpperCase().includes(m));
        }
        if (name) {
          const n = name.toLowerCase();
          filtered = filtered.filter((r) => (r.name ?? '').toLowerCase().includes(n));
        }
        if (filtered.length === 0) {
          return textResult('Filtreye uyan route bulunamadı.');
        }
        const table = [
          '| Method | URI | Name | Action | Middleware |',
          '| --- | --- | --- | --- | --- |',
          ...filtered.map(
            (r) => `| ${r.method} | \`${r.uri}\` | ${r.name ?? '—'} | ${r.action} | ${r.middleware || '—'} |`
          )
        ].join('\n');
        return textResult(`${filtered.length} route:\n\n${table}`);
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return errorResult(PHP_MISSING_HINT);
        }
        if (err instanceof ExecError) {
          return textResult(
            stripAnsi(err.stdout + (err.stderr ? '\n' + err.stderr : '')).trim() || 'Routes alınamadı.'
          );
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// laravel_migrations
// ──────────────────────────────────────────────────────────────────────

export const LARAVEL_MIGRATIONS_TOOL = 'laravel_migrations';

export const registerLaravelMigrationsTool = (server: McpServer): void => {
  server.registerTool(
    LARAVEL_MIGRATIONS_TOOL,
    {
      title: 'Laravel Migrations Status',
      description: "Laravel migration'larının çalıştırılıp çalıştırılmadığını listeler.",
      inputSchema: z.object({
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ projectPath }) => {
      logger.debug('tool.call', { tool: LARAVEL_MIGRATIONS_TOOL });
      const ws = resolveProjectRoot(projectPath);
      if (!existsSync(join(ws.root, 'artisan'))) {
        return errorResult('Bu proje bir Laravel projesi değil (artisan yok).');
      }
      try {
        const result = await runCommand(
          PHP_BIN,
          ['artisan', 'migrate:status', '--no-interaction'],
          { cwd: ws.root, timeoutMs: 30_000 }
        );
        return textResult(stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim());
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return errorResult(PHP_MISSING_HINT);
        }
        if (err instanceof ExecError) {
          return textResult(
            stripAnsi(err.stdout + (err.stderr ? '\n' + err.stderr : '')).trim() || 'Migration durumu alınamadı.'
          );
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};

// ──────────────────────────────────────────────────────────────────────
// symfony_console
// ──────────────────────────────────────────────────────────────────────

export const SYMFONY_CONSOLE_TOOL = 'symfony_console';

const findSymfonyConsole = (root: string): string | null => {
  for (const p of [
    join(root, 'bin', 'console'),
    join(root, 'app', 'console'),
    join(root, 'vendor', 'bin', 'symfony')
  ]) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
};

export const registerSymfonyConsoleTool = (server: McpServer): void => {
  server.registerTool(
    SYMFONY_CONSOLE_TOOL,
    {
      title: 'Symfony Console',
      description:
        "Symfony console komutlarını çalıştırır ('list', 'debug:container', 'cache:clear' vb.).",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .describe("Symfony console komutu. Örnek: 'debug:router', 'cache:clear --no-warmup'."),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ command, projectPath }) => {
      logger.debug('tool.call', { tool: SYMFONY_CONSOLE_TOOL, command });
      const ws = resolveProjectRoot(projectPath);
      const console = findSymfonyConsole(ws.root);
      if (!console) {
        return errorResult('Bu proje bir Symfony projesi değil (bin/console yok).');
      }
      const args = [console, ...command.split(/\s+/).filter((s) => s.length > 0), '--no-interaction'];
      try {
        const result = await runCommand(PHP_BIN, args, {
          cwd: ws.root,
          timeoutMs: DEFAULT_EXEC_TIMEOUT_MS
        });
        return textResult(
          stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim() || '(boş çıktı)'
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return errorResult(PHP_MISSING_HINT);
        }
        if (err instanceof ExecError) {
          return textResult(
            stripAnsi(err.stdout + (err.stderr ? '\n' + result_err_clean(err) : '')).trim() ||
              'Komut başarısız.'
          );
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};

const result_err_clean = (err: ExecError): string => err.stderr;

// ──────────────────────────────────────────────────────────────────────
// symfony_container
// ──────────────────────────────────────────────────────────────────────

export const SYMFONY_CONTAINER_TOOL = 'symfony_container';

export const registerSymfonyContainerTool = (server: McpServer): void => {
  server.registerTool(
    SYMFONY_CONTAINER_TOOL,
    {
      title: 'Symfony Container Debug',
      description:
        "Symfony service container'ından belirli bir servis veya tüm servis listesi hakkında bilgi döner.",
      inputSchema: z.object({
        service: z
          .string()
          .optional()
          .describe("Tek bir servis adı (örnek: 'App\\\\Service\\\\Mailer'). Boş bırakılırsa tüm servisler."),
        showArguments: z.boolean().default(false).describe('Servis argümanlarını göster.'),
        projectPath: z.string().optional().describe('İsteğe bağlı proje kökü (otomatik tespit edilir).')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ service, showArguments, projectPath }) => {
      logger.debug('tool.call', { tool: SYMFONY_CONTAINER_TOOL, service });
      const ws = resolveProjectRoot(projectPath);
      const console = findSymfonyConsole(ws.root);
      if (!console) {
        return errorResult('Bu proje bir Symfony projesi değil (bin/console yok).');
      }
      const args = [console, 'debug:container', '--no-interaction'];
      if (showArguments) {
        args.push('--show-arguments');
      }
      if (service) {
        args.push(service);
      }
      try {
        const result = await runCommand(PHP_BIN, args, {
          cwd: ws.root,
          timeoutMs: 30_000
        });
        return textResult(stripAnsi(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim());
      } catch (err) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          return errorResult(PHP_MISSING_HINT);
        }
        if (err instanceof ExecError) {
          return textResult(
            stripAnsi(err.stdout + (err.stderr ? '\n' + err.stderr : '')).trim() || 'Container alınamadı.'
          );
        }
        return errorResult(`Beklenmeyen hata: ${formatUnknown(err)}`);
      }
    }
  );
};

void readFileSync;
