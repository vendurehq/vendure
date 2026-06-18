import { CachedSession, SessionCacheStrategy } from './session-cache-strategy';

/**
 * @description
 * Caches session in memory, using a LRU cache implementation. Not suitable for
 * multi-server setups since the cache will be local to each instance, reducing
 * its effectiveness. By default the cache has a size of 1000, meaning that after
 * 1000 sessions have been cached, any new sessions will cause the least-recently-used
 * session to be evicted (removed) from the cache.
 *
 * The cache size can be configured by passing a different number to the constructor
 * function.
 *
 * @docsCategory auth
 */
export class InMemorySessionCacheStrategy implements SessionCacheStrategy {
    private readonly cache = new Map<string, CachedSession>();
    private readonly cacheSize: number = 1000;

    constructor(cacheSize?: number) {
        if (cacheSize != null) {
            if (cacheSize < 1) {
                throw new Error('cacheSize must be a positive integer');
            }
            this.cacheSize = Math.round(cacheSize);
        }
    }

    delete(sessionToken: string) {
        this.cache.delete(sessionToken);
    }

    get(sessionToken: string) {
        const item = this.cache.get(sessionToken);
        if (item) {
            // refresh key
            this.cache.delete(sessionToken);
            this.cache.set(sessionToken, item);
        }
        return item;
    }

    set(session: CachedSession) {
        this.cache.set(session.token, session);

        if (this.cache.has(session.token)) {
            // refresh key
            this.cache.delete(session.token);
        } else if (this.cache.size === this.cacheSize) {
            // evict oldest
            const oldest = this.first();
            if (oldest) {
                this.cache.delete(oldest);
            }
        }
        this.cache.set(session.token, session);
    }

    clear() {
        this.cache.clear();
    }

    private first() {
        return this.cache.keys().next().value;
    }
}
