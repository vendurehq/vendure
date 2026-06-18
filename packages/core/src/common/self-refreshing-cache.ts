import { Logger } from '../config/logger/vendure-logger';

/**
 * @description
 * A cache which automatically refreshes itself if the value is found to be stale.
 *
 * @docsCategory cache
 * @docsPage SelfRefreshingCache
 */
export interface SelfRefreshingCache<V, RefreshArgs extends any[] = []> {
    /**
     * @description
     * The current value of the cache. If the value is stale, the data will be refreshed and then
     * the fresh value will be returned.
     */
    value(...refreshArgs: RefreshArgs | [undefined] | []): Promise<V>;

    /**
     * @description
     * Allows a memoized function to be defined. For the given arguments, the `fn` function will
     * be invoked only once and its output cached and returned.
     * The results cache is cleared along with the rest of the cache according to the configured
     * `ttl` value.
     */
    memoize<Args extends any[], R>(
        args: Args,
        refreshArgs: RefreshArgs,
        fn: (value: V, ...args: Args) => R,
    ): Promise<R>;

    /**
     * @description
     * Force a refresh of the value, e.g. when it is known that the value has changed such as after
     * an update operation to the source data in the database.
     */
    refresh(...args: RefreshArgs): Promise<V>;
}

/**
 * @description
 * Configuration options for creating a {@link SelfRefreshingCache}.
 *
 * @docsCategory cache
 * @docsPage SelfRefreshingCache
 */
export interface SelfRefreshingCacheConfig<V, RefreshArgs extends any[]> {
    /**
     * @description
     * The name of the cache, used for logging purposes.
     * e.g. `'MyService.cachedValue'`.
     */
    name: string;
    /**
     * @description
     * The time-to-live (ttl) in milliseconds for the cache. After this time, the value will be considered stale
     * and will be refreshed the next time it is accessed.
     */
    ttl: number;
    /**
     * @description
     * The function which is used to refresh the value of the cache.
     * This function should return a Promise which resolves to the new value.
     */
    refresh: {
        fn: (...args: RefreshArgs) => Promise<V>;
        /**
         * Default arguments, passed to refresh function
         */
        defaultArgs: RefreshArgs;
    };
    /**
     * @description
     * Intended for unit testing the SelfRefreshingCache only.
     * By default uses `() => new Date().getTime()`
     */
    getTimeFn?: () => number;
}

/**
 * @description
 * Creates a {@link SelfRefreshingCache} object, which is used to cache a single frequently-accessed value. In this type
 * of cache, the function used to populate the value (`refreshFn`) is defined during the creation of the cache, and
 * it is immediately used to populate the initial value.
 *
 * From there, when the `.value` property is accessed, it will return a value from the cache, and if the
 * value has expired, it will automatically run the `refreshFn` to update the value and then return the
 * fresh value.
 *
 * @example
 * ```ts title="Example of creating a SelfRefreshingCache"
 * import { createSelfRefreshingCache } from '@vendure/core';
 *
 * \@Injectable()
 * export class PublicChannelService {
 *   private publicChannel: SelfRefreshingCache<Channel, [RequestContext]>;
 *
 *   async init() {
 *     this.publicChannel = await createSelfRefreshingCache<Channel, [RequestContext]>({
 *      name: 'PublicChannelService.publicChannel',
 *      ttl: 1000 * 60 * 60, // 1 hour
 *      refresh: {
 *        fn: async (ctx: RequestContext) => {
 *         return this.channelService.getPublicChannel(ctx);
 *       },
 *      defaultArgs: [RequestContext.empty()],
 *     },
 *   });
 * }
 * ```
 *
 * @docsCategory cache
 * @docsPage SelfRefreshingCache
 */
export async function createSelfRefreshingCache<V, RefreshArgs extends any[]>(
    config: SelfRefreshingCacheConfig<V, RefreshArgs>,
    refreshArgs?: RefreshArgs,
): Promise<SelfRefreshingCache<V, RefreshArgs>> {
    const { ttl, name, refresh, getTimeFn } = config;
    const getTimeNow = getTimeFn ?? (() => new Date().getTime());
    const initialValue: V = await refresh.fn(...(refreshArgs ?? refresh.defaultArgs));
    let value = initialValue;
    let expires = getTimeNow() + ttl;
    const memoCache = new Map<string, { expires: number; value: any }>();
    const refreshValue = (resetMemoCache = true, args: RefreshArgs): Promise<V> => {
        return refresh
            .fn(...args)
            .then(newValue => {
                value = newValue;
                expires = getTimeNow() + ttl;
                if (resetMemoCache) {
                    memoCache.clear();
                }
                return value;
            })
            .catch((err: any) => {
                const _message = err.message;
                const message = typeof _message === 'string' ? _message : JSON.stringify(err.message);
                Logger.error(
                    `Failed to update SelfRefreshingCache "${name}": ${message}`,
                    undefined,
                    err.stack,
                );
                return value;
            });
    };
    const getValue = async (_refreshArgs?: RefreshArgs, resetMemoCache = true): Promise<V> => {
        const now = getTimeNow();
        if (expires < now) {
            return refreshValue(resetMemoCache, _refreshArgs ?? refresh.defaultArgs);
        }
        return value;
    };
    const memoize = async <Args extends any[], R>(
        args: Args,
        _refreshArgs: RefreshArgs,
        fn: (value: V, ...args: Args) => R,
    ): Promise<R> => {
        const key = JSON.stringify(args);
        const cached = memoCache.get(key);
        const now = getTimeNow();
        if (cached && now < cached.expires) {
            return cached.value;
        }
        const result = getValue(_refreshArgs, false).then(val => fn(val, ...args));
        memoCache.set(key, {
            expires: now + ttl,
            value: result,
        });
        return result;
    };
    return {
        value: (...args) =>
            getValue(
                !args.length || (args.length === 1 && args[0] === undefined)
                    ? undefined
                    : (args as RefreshArgs),
            ),
        refresh: (...args) => refreshValue(true, args),
        memoize,
    };
}
