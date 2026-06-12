/**
 * Active-operation registry.
 *
 * Each `runCommand` registers the `AbortController` it's driving, so
 * the server's cancellation handler can kill the right child process
 * when the model (or the user) cancels the call.
 *
 * The map is keyed by a short random id and bounded — entries are
 * removed as soon as the operation completes, so memory pressure is
 * proportional to the number of *concurrent* long-running tools.
 */

import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

export interface ActiveOp {
  readonly id: string;
  readonly label: string;
  readonly startedAt: number;
  readonly controller: AbortController;
}

const active = new Map<string, ActiveOp>();

export const registerOp = (label: string, controller: AbortController): string => {
  const id = randomUUID();
  const op: ActiveOp = { id, label, startedAt: Date.now(), controller };
  active.set(id, op);
  logger.debug('op.register', { id, label });
  return id;
};

export const unregisterOp = (id: string): void => {
  if (active.delete(id)) {
    logger.debug('op.unregister', { id });
  }
};

export const getOp = (id: string): ActiveOp | undefined => active.get(id);

export const listOps = (): readonly ActiveOp[] => Array.from(active.values());

export const cancelOp = (id: string, reason: string): boolean => {
  const op = active.get(id);
  if (!op) {
    return false;
  }
  logger.info('op.cancel', { id, label: op.label, reason });
  op.controller.abort(new Error(reason));
  return true;
};

export const cancelAll = (reason: string): number => {
  let count = 0;
  for (const op of active.values()) {
    op.controller.abort(new Error(reason));
    count += 1;
  }
  return count;
};

export const wrapWithRegistration = async <T>(
  label: string,
  parentSignal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
  const controller = new AbortController();
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener(
        'abort',
        () => controller.abort(parentSignal.reason),
        { once: true }
      );
    }
  }
  const id = registerOp(label, controller);
  try {
    return await fn(controller.signal);
  } finally {
    unregisterOp(id);
  }
};
