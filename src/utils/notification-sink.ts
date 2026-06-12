/**
 * MCP logging notification bridge.
 *
 * Tools can call `progress(message)` and `mcpLog(level, data)` to send
 * structured updates to the MCP client while the tool is running.
 *
 * The active notification sink is installed by `server.ts` once the
 * transport is connected — before that, calls are silently no-ops.
 */

type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

export interface ProgressUpdate {
  readonly current: number;
  readonly total?: number;
  readonly message?: string;
}

export interface NotificationSink {
  readonly log: (level: LogLevel, data: string | Record<string, unknown>) => Promise<void>;
  readonly progress: (update: ProgressUpdate) => Promise<void>;
  readonly isConnected: () => boolean;
}

const NOOP_SINK: NotificationSink = {
  log: async () => {
    /* no-op */
  },
  progress: async () => {
    /* no-op */
  },
  isConnected: () => false
};

let currentSink: NotificationSink = NOOP_SINK;

export const installSink = (sink: NotificationSink): void => {
  currentSink = sink;
};

export const resetSink = (): void => {
  currentSink = NOOP_SINK;
};

export const mcpLog = (level: LogLevel, data: string | Record<string, unknown>): Promise<void> =>
  currentSink.log(level, data);

export const progress = (update: ProgressUpdate): Promise<void> =>
  currentSink.progress(update);

export const isNotificationsAvailable = (): boolean => currentSink.isConnected();
