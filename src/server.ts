/**
 * MCP server bootstrap.
 *
 * Wires every tool, resource and prompt into a single `McpServer`
 * instance, attaches the stdio transport and connects it. Keep this
 * file thin — the actual logic lives in `./tools/*`, `./resources.ts`
 * and `./prompts.ts` so each module is independently testable and
 * replaceable.
 */

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';

import {
  SERVER_DESCRIPTION,
  SERVER_NAME,
  SERVER_VERSION
} from './constants.js';
import { logger } from './utils/logger.js';
import { installSink, type NotificationSink } from './utils/notification-sink.js';
import { cancelOp, listOps } from './utils/active-ops.js';
import { registerGetPhpInfoTool, probePhpBinary } from './tools/get-php-info.js';
import { registerLintPhpFileTool } from './tools/lint-php-file.js';
import { registerAnalyzePhpCodeTool } from './tools/analyze-php-code.js';
import { registerFormatPhpCodeTool } from './tools/format-php-code.js';
import { registerRunPhpScriptTool } from './tools/run-php-script.js';
import { registerShowOpcacheStatusTool } from './tools/show-opcache-status.js';
import { registerGetExtensionInfoTool } from './tools/get-extension-info.js';
import { registerGetPhpIniTool } from './tools/get-php-ini.js';
import { registerCheckPhpCompatibilityTool } from './tools/check-php-compatibility.js';
import { registerRunPhpunitTool } from './tools/run-phpunit.js';
import { registerRunPsalmTool } from './tools/run-psalm.js';
import { registerRunPhpmdTool } from './tools/run-phpmd.js';
import { registerRunPhpcsTool } from './tools/run-phpcs.js';
import { registerRunPhpmndTool } from './tools/run-phpmnd.js';
import { registerRunRectorTool } from './tools/run-rector.js';
import { registerRunPhpInsightsTool } from './tools/run-phpinsights.js';
import { registerRunPhpCpdTool } from './tools/run-phpcpd.js';
import {
  registerComposerInfoTool,
  registerComposerValidateTool,
  registerComposerAuditTool,
  registerComposerOutdatedTool,
  registerComposerRequireTool,
  registerComposerRemoveTool,
  registerComposerInstallTool,
  registerComposerUpdateTool,
  registerComposerDumpAutoloadTool
} from './tools/composer.js';
import {
  registerScanSecretsTool,
  registerScanVulnerableFunctionsTool,
  registerScanSqlInjectionTool,
  registerScanXssTool
} from './tools/scan-security.js';
import {
  registerAddStrictTypesTool,
  registerGeneratePhpdocTool,
  registerSuggestRefactoringTool
} from './tools/codegen.js';
import {
  registerDetectFrameworkTool,
  registerLaravelArtisanTool,
  registerLaravelRoutesTool,
  registerLaravelMigrationsTool,
  registerSymfonyConsoleTool,
  registerSymfonyContainerTool
} from './tools/framework.js';
import { registerAllResources } from './resources.js';
import { registerAllPrompts } from './prompts.js';
import { registerDoctorTool } from './tools/doctor.js';
import { registerInitTool } from './tools/init.js';

const registerAllTools = (server: McpServer): void => {
  // ─── Runtime / environment ─────────────────────────────────────
  registerGetPhpInfoTool(server);
  registerShowOpcacheStatusTool(server);
  registerGetExtensionInfoTool(server);
  registerGetPhpIniTool(server);

  // ─── Lint / format / syntax ────────────────────────────────────
  registerLintPhpFileTool(server);
  registerRunPhpcsTool(server);
  registerFormatPhpCodeTool(server);
  registerAddStrictTypesTool(server);

  // ─── Static analysis ───────────────────────────────────────────
  registerAnalyzePhpCodeTool(server);
  registerRunPsalmTool(server);
  registerRunPhpmdTool(server);
  registerRunPhpmndTool(server);
  registerRunPhpCpdTool(server);
  registerRunPhpInsightsTool(server);
  registerSuggestRefactoringTool(server);

  // ─── Refactoring & codegen ─────────────────────────────────────
  registerRunRectorTool(server);
  registerGeneratePhpdocTool(server);

  // ─── Compatibility ─────────────────────────────────────────────
  registerCheckPhpCompatibilityTool(server);

  // ─── Execute & test ────────────────────────────────────────────
  registerRunPhpScriptTool(server);
  registerRunPhpunitTool(server);

  // ─── Composer ──────────────────────────────────────────────────
  registerComposerInfoTool(server);
  registerComposerValidateTool(server);
  registerComposerAuditTool(server);
  registerComposerOutdatedTool(server);
  registerComposerRequireTool(server);
  registerComposerRemoveTool(server);
  registerComposerInstallTool(server);
  registerComposerUpdateTool(server);
  registerComposerDumpAutoloadTool(server);

  // ─── Security ──────────────────────────────────────────────────
  registerScanSecretsTool(server);
  registerScanVulnerableFunctionsTool(server);
  registerScanSqlInjectionTool(server);
  registerScanXssTool(server);

  // ─── Framework detection & integration ─────────────────────────
  registerDetectFrameworkTool(server);
  registerLaravelArtisanTool(server);
  registerLaravelRoutesTool(server);
  registerLaravelMigrationsTool(server);
  registerSymfonyConsoleTool(server);
  registerSymfonyContainerTool(server);

  // ─── Killer features ───────────────────────────────────────────
  registerDoctorTool(server);
  registerInitTool(server);
};

const registerAllServerFeatures = (server: McpServer): void => {
  registerAllTools(server);
  registerAllResources(server);
  registerAllPrompts(server);
};

const createStdioSink = (server: McpServer): NotificationSink => {
  const sendNotify = (method: string, params: Record<string, unknown>) => {
    try {
      void server.server.notification({ method, params });
    } catch (err) {
      logger.debug('notify.failed', { method, error: String(err) });
    }
  };
  return {
    log: async (level, data) => {
      sendNotify('notifications/message', {
        level,
        logger: 'phpustik',
        data: typeof data === 'string' ? { message: data } : data
      });
    },
    progress: async (update) => {
      sendNotify('notifications/progress', {
        progressToken: 'phpustik-progress',
        progress: update.current,
        total: update.total,
        message: update.message ?? ''
      });
    },
    isConnected: () => true
  };
};

export const buildServer = (): McpServer => {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, description: SERVER_DESCRIPTION },
    { capabilities: { logging: {} } }
  );

  // Hook the notification sink BEFORE the transport is connected, so the
  // first tool call (e.g. a doctor) can stream progress.
  installSink(createStdioSink(server));

  registerAllServerFeatures(server);
  return server;
};

const installSignalHandlers = (): void => {
  const shutdown = (signal: NodeJS.Signals): void => {
    const active = listOps();
    logger.info('shutdown.signal', { signal, activeOps: active.length });
    for (const op of active) {
      cancelOp(op.id, `shutdown:${signal}`);
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  process.on('uncaughtException', (err) => {
    logger.error('process.uncaughtException', { message: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandledRejection', { reason: String(reason) });
  });
};

export const main = async (): Promise<void> => {
  installSignalHandlers();

  logger.info('server.boot', { name: SERVER_NAME, version: SERVER_VERSION });

  const probe = await probePhpBinary();
  if (!probe.available) {
    logger.warn('server.php_missing', { hint: probe.error });
  } else {
    logger.info('server.php_detected', { version: probe.version });
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('server.ready', { transport: 'stdio' });
};
