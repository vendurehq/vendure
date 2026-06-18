import { CachedSession, Logger, SessionCacheStrategy, VendurePlugin } from '@vendure/core';
import { Redis, RedisOptions } from 'ioredis';

const loggerCtx = 'RedisSessionCacheStrategy';
const DEFAULT_NAMESPACE = 'vendure-session-cache';

export class RedisSessionCacheStrategy implements SessionCacheStrategy {
    private client: Redis;

    constructor(private options: RedisSessionCachePluginOptions) {}

    init() {
        this.client = new Redis(this.options.redisOptions as RedisOptions);
        this.client.on('error', err => Logger.error(err.message, loggerCtx, err.stack));
    }

    async destroy() {
        await this.client.quit();
    }

    async get(sessionToken: string): Promise<CachedSession | undefined> {
        try {
            const retrieved = await this.client.get(this.namespace(sessionToken));
            if (retrieved) {
                try {
                    return JSON.parse(retrieved);
                } catch (e: any) {
                    Logger.error(`Could not parse cached session data: ${e.message}`, loggerCtx);
                }
            }
        } catch (e: any) {
            Logger.error(`Could not get cached session: ${e.message}`, loggerCtx);
        }
    }

    async set(session: CachedSession) {
        try {
            await this.client.set(this.namespace(session.token), JSON.stringify(session));
        } catch (e: any) {
            Logger.error(`Could not set cached session: ${e.message}`, loggerCtx);
        }
    }

    async delete(sessionToken: string) {
        try {
            await this.client.del(this.namespace(sessionToken));
        } catch (e: any) {
            Logger.error(`Could not delete cached session: ${e.message}`, loggerCtx);
        }
    }

    clear() {
        // not implemented
    }

    private namespace(key: string) {
        return `${this.options.namespace ?? DEFAULT_NAMESPACE}:${key}`;
    }
}

export interface RedisSessionCachePluginOptions {
    namespace?: string;
    redisOptions?: RedisOptions;
}

@VendurePlugin({
    configuration: config => {
        config.authOptions.sessionCacheStrategy = new RedisSessionCacheStrategy(
            RedisSessionCachePlugin.options,
        );
        return config;
    },
})
export class RedisSessionCachePlugin {
    static options: RedisSessionCachePluginOptions;

    static init(options: RedisSessionCachePluginOptions) {
        this.options = options;
        return this;
    }
}
