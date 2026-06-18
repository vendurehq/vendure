import { describe, expect, it } from 'vitest';

import { patchEntity } from './patch-entity';

describe('patchEntity()', () => {
    it('updates non-undefined values', () => {
        const entity: any = {
            foo: 'foo',
            bar: 'bar',
            baz: 'baz',
        };

        const result = patchEntity(entity, { bar: 'bar2', baz: undefined });
        expect(result).toEqual({
            foo: 'foo',
            bar: 'bar2',
            baz: 'baz',
        });
    });

    it('updates null values', () => {
        const entity: any = {
            foo: 'foo',
            bar: 'bar',
            baz: 'baz',
        };

        const result = patchEntity(entity, { bar: null });
        expect(result).toEqual({
            foo: 'foo',
            bar: null,
            baz: 'baz',
        });
    });

    it('does not update id field', () => {
        const entity: any = {
            id: 123,
            bar: 'bar',
        };

        const result = patchEntity(entity, { id: 456 });
        expect(result).toEqual({
            id: 123,
            bar: 'bar',
        });
    });

    it('updates individual customFields', () => {
        const entity: any = {
            customFields: {
                cf1: 'cf1',
                cf2: 'cf2',
            },
        };

        const result = patchEntity(entity, { customFields: { cf2: 'foo' } });
        expect(result).toEqual({
            customFields: {
                cf1: 'cf1',
                cf2: 'foo',
            },
        });
    });

    it('handles missing input customFields', () => {
        const entity: any = {
            f1: 'f1',
            customFields: {
                cf1: 'cf1',
                cf2: 'cf2',
            },
        };

        const result = patchEntity(entity, { f1: 'foo' });
        expect(result).toEqual({
            f1: 'foo',
            customFields: {
                cf1: 'cf1',
                cf2: 'cf2',
            },
        });
    });
});
