import { CacheService, mergeConfig, RedisCachePlugin } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    deletesAKey,
    getReturnsUndefinedForNonExistentKey,
    invalidatesALargeNumberOfKeysByTag,
    invalidatesByMultipleTags,
    invalidatesBySingleTag,
    invalidatesManyByMultipleTags,
    invalidTTLsShouldNotSetKey,
    setsAKey,
    setsArrayOfObjects,
    setsArrayValue,
    setsObjectValue,
} from './fixtures/cache-service-shared-tests';

/**
 * Checks if Redis is available at the specified host and port
 */
async function isRedisAvailable(host: string, port: number): Promise<boolean> {
    try {
        const IORedis = await import('ioredis').then(m => m.default);
        const testClient = new IORedis.Redis({
            host,
            port,
            connectTimeout: 2000,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
        });

        await testClient.ping();
        await testClient.quit();
        return true;
    } catch (error) {
        return false;
    }
}

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;

describe('CacheService with RedisCachePlugin', async () => {
    const redisAvailable = await isRedisAvailable(redisHost, redisPort);

    if (!redisAvailable) {
        // eslint-disable-next-line no-console
        console.warn(`Redis server not available at ${redisHost}:${redisPort}. Skipping Redis cache tests.`);
    }

    describe.skipIf(!redisAvailable)('Redis Cache Tests', () => {
        let cacheService: CacheService;
        let redis: import('ioredis').Redis;

        const { server, adminClient } = createTestEnvironment(
            mergeConfig(testConfig(), {
                plugins: [
                    RedisCachePlugin.init({
                        redisOptions: {
                            host: redisHost,
                            port: redisPort,
                        },
                    }),
                ],
            }),
        );

        beforeAll(async () => {
            await server.init({
                initialData,
                productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
                customerCount: 1,
            });
            await adminClient.asSuperAdmin();
            cacheService = server.app.get(CacheService);
            const IORedis = await import('ioredis').then(m => m.default);
            redis = new IORedis.Redis({ host: redisHost, port: redisPort });
        }, TEST_SETUP_TIMEOUT_MS);

        afterAll(async () => {
            await redis.quit();
            await server.destroy();
        });

        it('get returns undefined for non-existent key', () =>
            getReturnsUndefinedForNonExistentKey(cacheService));

        it('sets a key', () => setsAKey(cacheService));

        it('sets an object value', () => setsObjectValue(cacheService));

        it('sets an array value', () => setsArrayValue(cacheService));

        it('sets an array of objects', () => setsArrayOfObjects(cacheService));

        it('deletes a key', () => deletesAKey(cacheService));

        it('sets a key with ttl', async () => {
            await cacheService.set('test-key1', 'test-value', { ttl: 1000 });
            const result = await cacheService.get('test-key1');
            expect(result).toBe('test-value');

            await new Promise(resolve => setTimeout(resolve, 1500));

            const result2 = await cacheService.get('test-key1');

            expect(result2).toBeUndefined();
        });

        it('sets a key with sub-second ttl', async () => {
            await cacheService.set('test-key2', 'test-value', { ttl: 900 });
            const result = await cacheService.get('test-key2');
            expect(result).toBe('test-value');

            await new Promise(resolve => setTimeout(resolve, 1500));

            const result2 = await cacheService.get('test-key2');

            expect(result2).toBeUndefined();
        });

        it('invalidates by single tag', () => invalidatesBySingleTag(cacheService));

        it('invalidates by multiple tags', () => invalidatesByMultipleTags(cacheService));

        it('invalidates many by multiple tags', () => invalidatesManyByMultipleTags(cacheService));

        it('invalidates a large number of keys by tag', () =>
            invalidatesALargeNumberOfKeysByTag(cacheService));

        it('invalid ttls should not set key', () => invalidTTLsShouldNotSetKey(cacheService));

        // #5682 — tag sets must not keep members whose keys have expired
        it('prunes expired keys from a tag set', async () => {
            const tagKey = 'vendure-cache:ztag:churn-tag';
            await redis.del(tagKey);
            for (let i = 0; i < 50; i++) {
                await cacheService.set(`churn-key${i}`, 'value', { ttl: 1000, tags: ['churn-tag'] });
            }
            expect(await redis.zcard(tagKey)).toBe(50);

            await new Promise(resolve => setTimeout(resolve, 1500));
            await cacheService.set('churn-key-fresh', 'value', { ttl: 1000, tags: ['churn-tag'] });

            expect(await redis.zrange(tagKey, 0, -1)).toEqual(['vendure-cache:churn-key-fresh']);
        });

        // #5682
        it('expires a tag set with its longest-lived key', async () => {
            const tagKey = 'vendure-cache:ztag:expiring-tag';
            await cacheService.set('expiring-key1', 'value', { ttl: 5000, tags: ['expiring-tag'] });
            await cacheService.set('expiring-key2', 'value', { ttl: 1000, tags: ['expiring-tag'] });

            const pttl = await redis.pttl(tagKey);
            expect(pttl).toBeGreaterThan(4000);
            expect(pttl).toBeLessThanOrEqual(5000);
        });

        // #5682
        it('shortens a tag set expiry when its longest-lived key is re-set with a shorter ttl', async () => {
            const tagKey = 'vendure-cache:ztag:shortened-tag';
            await cacheService.set('shortened-key', 'value', { tags: ['shortened-tag'] });
            expect(await redis.pttl(tagKey)).toBeGreaterThan(5000);

            await cacheService.set('shortened-key', 'value', { ttl: 1000, tags: ['shortened-tag'] });

            const pttl = await redis.pttl(tagKey);
            expect(pttl).toBeGreaterThan(0);
            expect(pttl).toBeLessThanOrEqual(1000);
        });

        // #5682
        it('invalidates keys tagged in the legacy SET format', async () => {
            const legacyTagKey = 'vendure-cache:tag:legacy-tag';
            await redis.set('vendure-cache:legacy-key', JSON.stringify('value'));
            await redis.sadd(legacyTagKey, 'vendure-cache:legacy-key');

            await cacheService.set('new-key', 'value', { tags: ['legacy-tag'] });
            expect(await cacheService.get('new-key')).toBe('value');

            await cacheService.invalidateTags(['legacy-tag']);

            expect(await cacheService.get('legacy-key')).toBeUndefined();
            expect(await cacheService.get('new-key')).toBeUndefined();
            expect(await redis.exists(legacyTagKey, 'vendure-cache:ztag:legacy-tag')).toBe(0);
        });

        // #5682
        it('invalidates a tag larger than one batch', async () => {
            const count = 2500;
            const keys = Array.from({ length: count }, (_, i) => `large-tag-key${i}`);
            const legacyKeys = keys.map(key => `vendure-cache:legacy-${key}`);
            await Promise.all(keys.map(key => cacheService.set(key, 'value', { tags: ['large-tag'] })));
            await redis.mset(legacyKeys.flatMap(key => [key, JSON.stringify('value')]));
            await redis.sadd('vendure-cache:tag:large-tag', ...legacyKeys);
            expect(await redis.zcard('vendure-cache:ztag:large-tag')).toBe(count);

            await cacheService.invalidateTags(['large-tag']);

            expect(await redis.exists(...keys.map(key => `vendure-cache:${key}`))).toBe(0);
            expect(await redis.exists(...legacyKeys)).toBe(0);
            expect(await redis.exists('vendure-cache:ztag:large-tag', 'vendure-cache:tag:large-tag')).toBe(0);
        });
    });
});
