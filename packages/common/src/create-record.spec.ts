import { describe, expect, it } from 'vitest';

import { CREATE_RECORD_PATH, CREATE_RECORD_VERSION, parseCreateRecord } from './create-record';

const valid = {
    version: 1,
    createdWith: '4.0.0',
    packageManager: 'pnpm',
    preset: { name: 'single-country', options: { country: 'AT', currency: 'EUR' } },
    scenario: { name: 'default', package: 'some-scenario', version: '4.0.0' },
    features: ['b2b'],
    storefront: 'nextjs',
    agents: ['claude', 'cursor'],
};

describe('parseCreateRecord()', () => {
    it('has the path and version of the contract', () => {
        expect(CREATE_RECORD_PATH).toBe('.vendure/create.json');
        expect(CREATE_RECORD_VERSION).toBe(1);
    });

    it('returns a valid record', () => {
        expect(parseCreateRecord(valid)).toEqual({ result: 'ok', record: valid });
    });

    it('accepts a null preset, scenario and storefront', () => {
        const record = { ...valid, preset: null, scenario: null, storefront: null };
        expect(parseCreateRecord(record)).toEqual({ result: 'ok', record });
    });

    it('ignores unknown fields', () => {
        const result = parseCreateRecord({ ...valid, futureField: true });
        expect(result).toEqual({ result: 'ok', record: valid });
    });

    it('reports a newer version without reading the rest', () => {
        expect(parseCreateRecord({ version: 2, preset: 'anything' })).toEqual({
            result: 'unsupported-version',
            version: 2,
        });
    });

    it('rejects a value that is not an object', () => {
        expect(parseCreateRecord('x')).toEqual(
            expect.objectContaining({ result: 'invalid', field: undefined }),
        );
        expect(parseCreateRecord([valid])).toEqual(
            expect.objectContaining({ result: 'invalid', field: undefined }),
        );
    });

    it.each([
        ['version', { version: '1' }],
        ['version', { version: 0 }],
        ['version', { version: 1.5 }],
        ['createdWith', { createdWith: 4 }],
        ['createdWith', { createdWith: '' }],
        ['packageManager', { packageManager: 'deno' }],
        ['preset', { preset: { name: 'uk' } }],
        ['preset', { preset: { name: 'uk', options: { count: 3 } } }],
        ['preset', { preset: undefined }],
        ['preset', { preset: { name: '', options: {} } }],
        ['preset', { preset: { name: 'uk', options: ['GB'] } }],
        ['scenario', { scenario: { name: 'default', package: 'x' } }],
        ['scenario', { scenario: { name: 'default', package: '', version: '1.0.0' } }],
        ['scenario', { scenario: { name: '', package: 'x', version: '1.0.0' } }],
        ['features', { features: 'b2b' }],
        ['features', { features: [''] }],
        ['storefront', { storefront: undefined }],
        ['storefront', { storefront: '' }],
        ['agents', { agents: [1] }],
    ])('names the invalid field %s', (field, patch) => {
        expect(parseCreateRecord({ ...valid, ...patch })).toEqual(
            expect.objectContaining({ result: 'invalid', field }),
        );
    });
});
