import { CacheService, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { TestingCacheTtlProvider } from '../src/cache/cache-ttl-provider';
import { InMemoryCacheStrategy } from '../src/config/system/in-memory-cache-strategy';

import {
    deletesAKey,
    evictsTheOldestKeyWhenCacheIsFull,
    getReturnsUndefinedForNonExistentKey,
    invalidatesALargeNumberOfKeysByTag,
    invalidatesByMultipleTags,
    invalidatesBySingleTag,
    invalidatesManyByMultipleTags,
    invalidTTLsShouldNotSetKey,
    setsAKey,
    setsAKeyWithSubSecondTtl,
    setsAKeyWithTtl,
    setsArrayOfObjects,
    setsArrayValue,
    setsObjectValue,
} from './fixtures/cache-service-shared-tests';

describe('CacheService in-memory', () => {
    const ttlProvider = new TestingCacheTtlProvider();

    let cacheService: CacheService;
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            systemOptions: {
                cacheStrategy: new InMemoryCacheStrategy({
                    cacheSize: 5,
                    cacheTtlProvider: ttlProvider,
                }),
            },
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
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('get returns undefined for non-existent key', () =>
        getReturnsUndefinedForNonExistentKey(cacheService));

    it('sets a key', () => setsAKey(cacheService));

    it('sets an object value', () => setsObjectValue(cacheService));

    it('sets an array value', () => setsArrayValue(cacheService));

    it('sets an array of objects', () => setsArrayOfObjects(cacheService));

    it('deletes a key', () => deletesAKey(cacheService));

    it('sets a key with ttl', () => setsAKeyWithTtl(cacheService, ttlProvider));

    it('sets a key with sub-second ttl', () => setsAKeyWithSubSecondTtl(cacheService, ttlProvider));

    it('evicts the oldest key when cache is full', () => evictsTheOldestKeyWhenCacheIsFull(cacheService));

    it('invalidates by single tag', () => invalidatesBySingleTag(cacheService));

    it('invalidates by multiple tags', () => invalidatesByMultipleTags(cacheService));

    it('invalidates many by multiple tags', () => invalidatesManyByMultipleTags(cacheService));

    it('invalidates a large number of keys by tag', () => invalidatesALargeNumberOfKeysByTag(cacheService));

    it('invalid ttls should not set key', () => invalidTTLsShouldNotSetKey(cacheService));
});
