import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { CacheService } from '../../cache/index';
import { Injector } from '../../common/injector';

import { CachedSession, SessionCacheStrategy } from './session-cache-strategy';

/**
 * @description
 * The default {@link SessionCacheStrategy} delegates to the configured
 * {@link CacheStrategy} to store the session data. This should be suitable
 * for most use-cases, assuming you select a suitable {@link CacheStrategy}
 *
 * @since 3.1.0
 * @docsCategory auth
 */
export class DefaultSessionCacheStrategy implements SessionCacheStrategy {
    protected cacheService: CacheService;
    private readonly tags = ['DefaultSessionCacheStrategy'];

    constructor(
        private options?: {
            ttl?: number;
            cachePrefix?: string;
        },
    ) {}

    init(injector: Injector) {
        this.cacheService = injector.get(CacheService);
    }

    set(session: CachedSession): Promise<void> {
        return this.cacheService.set(this.getCacheKey(session.token), this.serializeDates(session), {
            tags: this.tags,
            ttl: this.options?.ttl ?? 24 * 60 * 60 * 1000,
        });
    }

    async get(sessionToken: string): Promise<CachedSession | undefined> {
        const cacheKey = this.getCacheKey(sessionToken);
        const item = await this.cacheService.get<JsonCompatible<CachedSession>>(cacheKey);
        return item ? this.deserializeDates(item) : undefined;
    }

    delete(sessionToken: string): void | Promise<void> {
        return this.cacheService.delete(this.getCacheKey(sessionToken));
    }

    clear(): Promise<void> {
        // We use the `?` here because there is a case where in the SessionService,
        // the clearSessionCacheOnDataChange() method may be invoked during bootstrap prior to
        // the cacheService being initialized in the `init()` method above.
        // This is an edge-case limited to seeding initial data as in e2e tests or a
        // @vendure/create installation, so it is safe to not invalidate the cache in this case.
        return this.cacheService?.invalidateTags(this.tags);
    }

    /**
     * @description
     * The `CachedSession` interface includes a `Date` object, which we need to
     * manually serialize/deserialize to/from JSON.
     */
    private serializeDates(session: CachedSession) {
        return {
            ...session,
            expires: session.expires.toISOString(),
        } as JsonCompatible<CachedSession>;
    }

    private deserializeDates(session: JsonCompatible<CachedSession>): CachedSession {
        return {
            ...session,
            expires: new Date(session.expires),
        };
    }

    private getCacheKey(sessionToken: string) {
        return `${this.options?.cachePrefix ?? 'vendure-session-cache'}:${sessionToken}`;
    }
}
