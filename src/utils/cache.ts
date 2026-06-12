/**
 * Tiny in-process TTL cache.
 *
 * Used for expensive, deterministic operations:
 *   - composer info / outdated (can take 5-15 s on large projects)
 *   - phpstan / psalm analysis (minutes)
 *   - framework detection (filesystem scan)
 *
 * The cache is intentionally simple: one Map, per-key TTL, no eviction
 * beyond expiry. The MCP server is a long-lived process, so memory
 * pressure is real — keep TTLs short and the value size small.
 */

export interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;

  public constructor(defaultTtlMs: number = 30_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  public get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  public set(key: string, value: T, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.store.set(key, { value, expiresAt });
  }

  public getOrCompute<U>(key: string, compute: () => Promise<U>, ttlMs?: number): Promise<U> {
    const cached = this.get(key) as U | undefined;
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    return compute().then((value) => {
      this.set(key, value as unknown as T, ttlMs);
      return value;
    });
  }

  public invalidate(key: string): void {
    this.store.delete(key);
  }

  public invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count += 1;
      }
    }
    return count;
  }

  public clear(): void {
    this.store.clear();
  }

  public get size(): number {
    return this.store.size;
  }
}

/** Default cache for tool results — 60 s feels right for a chat-driven workflow. */
export const toolCache = new TtlCache<unknown>(60_000);
