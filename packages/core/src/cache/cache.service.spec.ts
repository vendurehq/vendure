import { ModuleRef } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../config/config.service';
import { CacheStrategy } from '../config/system/cache-strategy';

import { CacheService } from './cache.service';

describe('CacheService lifecycle', () => {
    it('initializes the CacheStrategy before the first operation', async () => {
        let initialized = false;
        const init = vi.fn(() => {
            initialized = true;
        });
        const get = vi.fn(() => {
            if (!initialized) {
                throw new Error('CacheStrategy is not initialized');
            }
            return Promise.resolve(undefined);
        });
        const destroy = vi.fn();
        const cacheStrategy: CacheStrategy = {
            init,
            destroy,
            get,
            set: vi.fn(),
            delete: vi.fn(),
            invalidateTags: vi.fn(),
        };
        const cacheService = createCacheService(cacheStrategy);

        await cacheService.get('test-key');
        await cacheService.onModuleInit();
        await cacheService.onApplicationShutdown();

        expect(init).toHaveBeenCalledOnce();
        expect(get).toHaveBeenCalledOnce();
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('coalesces concurrent initialization attempts', async () => {
        let finishInitialization = () => undefined;
        const initialization = new Promise<void>(resolve => {
            finishInitialization = resolve;
        });
        const init = vi.fn(() => initialization);
        const get = vi.fn();
        const cacheStrategy: CacheStrategy = {
            init,
            get,
            set: vi.fn(),
            delete: vi.fn(),
            invalidateTags: vi.fn(),
        };
        const cacheService = createCacheService(cacheStrategy);

        const first = cacheService.get('first');
        const second = cacheService.get('second');
        finishInitialization();
        await Promise.all([first, second]);

        expect(init).toHaveBeenCalledOnce();
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('destroys only an initialized CacheStrategy', async () => {
        const destroy = vi.fn();
        const cacheStrategy: CacheStrategy = {
            init: vi.fn().mockRejectedValueOnce(new Error('initialization failed')),
            destroy,
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            invalidateTags: vi.fn(),
        };
        const cacheService = createCacheService(cacheStrategy);

        await expect(cacheService.onModuleInit()).rejects.toThrow('initialization failed');
        await cacheService.onApplicationShutdown();

        expect(destroy).not.toHaveBeenCalled();
    });
});

function createCacheService(cacheStrategy: CacheStrategy): CacheService {
    const configService = {
        systemOptions: { cacheStrategy },
    } as ConfigService;
    return new CacheService(configService, { get: vi.fn() } as unknown as ModuleRef);
}
