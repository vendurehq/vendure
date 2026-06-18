import { ID } from '@vendure/common/lib/shared-types';

import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { UserChannelPermissions } from '../../service/helpers/utils/get-user-channels-permissions';

/**
 * @description
 * A simplified representation of the User associated with the
 * current Session.
 *
 * @docsCategory auth
 * @docsPage SessionCacheStrategy
 */
export type CachedSessionUser = {
    id: ID;
    identifier: string;
    verified: boolean;
    channelPermissions: UserChannelPermissions[];
};

/**
 * @description
 * A simplified representation of a Session which is easy to
 * store.
 *
 * @docsCategory auth
 * @docsPage SessionCacheStrategy
 */
export type CachedSession = {
    /**
     * @description
     * The timestamp after which this cache entry is considered stale and
     * a fresh copy of the data will be set. Based on the `sessionCacheTTL`
     * option.
     */
    cacheExpiry: number;
    id: ID;
    token: string;
    expires: Date;
    activeOrderId?: ID;
    authenticationStrategy?: string;
    user?: CachedSessionUser;
    activeChannelId?: ID;
};

/**
 * @description
 * This strategy defines how sessions get cached. Since most requests will need the Session
 * object for permissions data, it can become a bottleneck to go to the database and do a multi-join
 * SQL query each time. Therefore, we cache the session data only perform the SQL query once and upon
 * invalidation of the cache.
 *
 * The Vendure default from v3.1+ is to use a the {@link DefaultSessionCacheStrategy}, which delegates
 * to the configured {@link CacheStrategy} to store the session data. This should be suitable
 * for most use-cases.
 *
 * :::note
 *
 * If you are using v3.1 or later, you should not normally need to implement a custom `SessionCacheStrategy`,
 * since this is now handled by the {@link DefaultSessionCacheStrategy}.
 *
 * :::
 *
 * Prior to v3.1, the default was to use the {@link InMemorySessionCacheStrategy}, which is fast but suitable for
 * single-instance deployments.
 *
 * :::info
 *
 * This is configured via the `authOptions.sessionCacheStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * Here's an example implementation using Redis. To use this, you need to add the
 * [ioredis package](https://www.npmjs.com/package/ioredis) as a dependency.
 *
 * @example
 * ```ts
 * import { CachedSession, Logger, SessionCacheStrategy, VendurePlugin } from '\@vendure/core';
 * import { Redis, RedisOptions } from 'ioredis';
 *
 * export interface RedisSessionCachePluginOptions {
 *   namespace?: string;
 *   redisOptions?: RedisOptions;
 * }
 * const loggerCtx = 'RedisSessionCacheStrategy';
 * const DEFAULT_NAMESPACE = 'vendure-session-cache';
 * const DEFAULT_TTL = 86400;
 *
 * export class RedisSessionCacheStrategy implements SessionCacheStrategy {
 *   private client: Redis;
 *   constructor(private options: RedisSessionCachePluginOptions) {}
 *
 *   init() {
 *     this.client = new Redis(this.options.redisOptions as RedisOptions);
 *     this.client.on('error', err => Logger.error(err.message, loggerCtx, err.stack));
 *   }
 *
 *   async destroy() {
 *     await this.client.quit();
 *   }
 *
 *   async get(sessionToken: string): Promise<CachedSession | undefined> {
 *     try {
 *       const retrieved = await this.client.get(this.namespace(sessionToken));
 *       if (retrieved) {
 *         try {
 *           return JSON.parse(retrieved);
 *         } catch (e: any) {
 *           Logger.error(`Could not parse cached session data: ${e.message}`, loggerCtx);
 *         }
 *       }
 *     } catch (e: any) {
 *       Logger.error(`Could not get cached session: ${e.message}`, loggerCtx);
 *     }
 *   }
 *
 *   async set(session: CachedSession) {
 *     try {
 *       await this.client.set(this.namespace(session.token), JSON.stringify(session), 'EX', DEFAULT_TTL);
 *     } catch (e: any) {
 *       Logger.error(`Could not set cached session: ${e.message}`, loggerCtx);
 *     }
 *   }
 *
 *   async delete(sessionToken: string) {
 *     try {
 *       await this.client.del(this.namespace(sessionToken));
 *     } catch (e: any) {
 *       Logger.error(`Could not delete cached session: ${e.message}`, loggerCtx);
 *     }
 *   }
 *
 *   clear() {
 *     // not implemented
 *   }
 *
 *   private namespace(key: string) {
 *     return `${this.options.namespace ?? DEFAULT_NAMESPACE}:${key}`;
 *   }
 * }
 *
 * \@VendurePlugin({
 *   configuration: config => {
 *     config.authOptions.sessionCacheStrategy = new RedisSessionCacheStrategy(
 *       RedisSessionCachePlugin.options,
 *     );
 *     return config;
 *   },
 * })
 * export class RedisSessionCachePlugin {
 *   static options: RedisSessionCachePluginOptions;
 *   static init(options: RedisSessionCachePluginOptions) {
 *     this.options = options;
 *     return this;
 *   }
 * }
 * ```
 *
 * @docsCategory auth
 * @docsPage SessionCacheStrategy
 * @docsWeight 0
 */
export interface SessionCacheStrategy extends InjectableStrategy {
    /**
     * @description
     * Store the session in the cache. When caching a session, the data
     * should not be modified apart from performing any transforms needed to
     * get it into a state to be stored, e.g. JSON.stringify().
     */
    set(session: CachedSession): void | Promise<void>;

    /**
     * @description
     * Retrieve the session from the cache
     */
    get(sessionToken: string): CachedSession | undefined | Promise<CachedSession | undefined>;

    /**
     * @description
     * Delete a session from the cache
     */
    delete(sessionToken: string): void | Promise<void>;

    /**
     * @description
     * Clear the entire cache
     */
    clear(): void | Promise<void>;
}
