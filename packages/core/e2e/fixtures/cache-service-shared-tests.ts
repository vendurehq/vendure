import { CacheService } from '@vendure/core';
import { expect } from 'vitest';

import { TestingCacheTtlProvider } from '../../src/cache/cache-ttl-provider';

export async function getReturnsUndefinedForNonExistentKey(cacheService: CacheService) {
    const result = await cacheService.get('non-existent-key');
    expect(result).toBeUndefined();
}

export async function setsAKey(cacheService: CacheService) {
    await cacheService.set('test-key', 'test-value');
    const result = await cacheService.get('test-key');
    expect(result).toBe('test-value');
}

export async function setsObjectValue(cacheService: CacheService) {
    const obj = { name: 'test', value: 42 };
    await cacheService.set('test-key', obj);
    const result = await cacheService.get('test-key');
    expect(result).toEqual(obj);
}

export async function setsArrayValue(cacheService: CacheService) {
    const arr = [1, 2, 3, 4, 5];
    await cacheService.set('test-key', arr);
    const result = await cacheService.get('test-key');
    expect(result).toEqual(arr);
}

export async function setsArrayOfObjects(cacheService: CacheService) {
    const arr = [
        { name: 'test1', value: 42 },
        { name: 'test2', value: 43 },
    ];
    await cacheService.set('test-key', arr);
    const result = await cacheService.get('test-key');
    expect(result).toEqual(arr);
}

export async function deletesAKey(cacheService: CacheService) {
    await cacheService.set('test-key', 'test-value');
    await cacheService.delete('test-key');
    const result = await cacheService.get('test-key');

    expect(result).toBeUndefined();
}

export async function setsAKeyWithTtl(cacheService: CacheService, ttlProvider: TestingCacheTtlProvider) {
    ttlProvider.setTime(new Date().getTime());
    await cacheService.set('test-key', 'test-value', { ttl: 1000 });
    const result = await cacheService.get('test-key');
    expect(result).toBe('test-value');

    ttlProvider.incrementTime(2000);

    const result2 = await cacheService.get('test-key');

    expect(result2).toBeUndefined();
}

export async function setsAKeyWithSubSecondTtl(
    cacheService: CacheService,
    ttlProvider: TestingCacheTtlProvider,
) {
    ttlProvider.setTime(new Date().getTime());
    await cacheService.set('test-key', 'test-value', { ttl: 900 });
    const result = await cacheService.get('test-key');
    expect(result).toBe('test-value');

    ttlProvider.incrementTime(2000);

    const result2 = await cacheService.get('test-key');

    expect(result2).toBeUndefined();
}

export async function evictsTheOldestKeyWhenCacheIsFull(cacheService: CacheService) {
    await cacheService.set('key1', 'value1');
    await new Promise(resolve => setTimeout(resolve, 1));
    await cacheService.set('key2', 'value2');
    await new Promise(resolve => setTimeout(resolve, 1));
    await cacheService.set('key3', 'value3');
    await new Promise(resolve => setTimeout(resolve, 1));
    await cacheService.set('key4', 'value4');
    await new Promise(resolve => setTimeout(resolve, 1));
    await cacheService.set('key5', 'value5');
    await new Promise(resolve => setTimeout(resolve, 1));

    const result1 = await cacheService.get('key1');
    expect(result1).toBe('value1');

    await cacheService.set('key6', 'value6');

    const result2 = await cacheService.get('key1');
    expect(result2).toBeUndefined();
}

export async function invalidatesBySingleTag(cacheService: CacheService) {
    await cacheService.set('taggedKey1.1', 'value1', { tags: ['tag1.1'] });
    await cacheService.set('taggedKey1.2', 'value2', { tags: ['tag1.2'] });

    expect(await cacheService.get('taggedKey1.1')).toBe('value1');
    expect(await cacheService.get('taggedKey1.2')).toBe('value2');

    await cacheService.invalidateTags(['tag1.1']);

    expect(await cacheService.get('taggedKey1.1')).toBeUndefined();
    expect(await cacheService.get('taggedKey1.2')).toBe('value2');
}

export async function invalidatesByMultipleTags(cacheService: CacheService) {
    await cacheService.set('taggedKey2.1', 'value1', { tags: ['tag2.1'] });
    await cacheService.set('taggedKey2.2', 'value2', { tags: ['tag2.2'] });

    expect(await cacheService.get('taggedKey2.1')).toBe('value1');
    expect(await cacheService.get('taggedKey2.2')).toBe('value2');

    await cacheService.invalidateTags(['tag2.1', 'tag2.2']);

    expect(await cacheService.get('taggedKey2.1')).toBeUndefined();
    expect(await cacheService.get('taggedKey2.2')).toBeUndefined();
}

export async function invalidatesManyByMultipleTags(cacheService: CacheService) {
    await cacheService.set('taggedKey3.1', 'data', { tags: ['tag3.1', 'tag3.4'] });
    await cacheService.set('taggedKey3.2', 'data', { tags: ['tag3.2', 'tag3.1'] });
    await cacheService.set('taggedKey3.3', 'data', { tags: ['tag3.4'] });
    await cacheService.set('taggedKey3.4', 'data', { tags: ['tag3.1'] });
    await cacheService.set('taggedKey3.5', 'data', { tags: ['tag3.2'] });

    await cacheService.invalidateTags(['tag3.2', 'tag3.4']);

    expect(await cacheService.get('taggedKey3.1')).toBeUndefined();
    expect(await cacheService.get('taggedKey3.2')).toBeUndefined();
    expect(await cacheService.get('taggedKey3.3')).toBeUndefined();
    expect(await cacheService.get('taggedKey3.4')).toBe('data');
    expect(await cacheService.get('taggedKey3.5')).toBeUndefined();
}

export async function invalidatesALargeNumberOfKeysByTag(cacheService: CacheService) {
    for (let i = 0; i < 100; i++) {
        await cacheService.set(`taggedKey${i}`, `value${i}`, { tags: ['tag'] });
    }
    await cacheService.invalidateTags(['tag']);

    for (let i = 0; i < 100; i++) {
        expect(await cacheService.get(`taggedKey${i}`)).toBeUndefined();
    }
}

export async function invalidTTLsShouldNotSetKey(cacheService: CacheService) {
    await cacheService.set('test-key', 'test-value', { ttl: -1500 });
    const result = await cacheService.get('test-key');

    expect(result).toBeUndefined();
}
