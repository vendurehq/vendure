import { describe, expect, it } from 'vitest';

import { Order, Sale } from '../../../entity';

import { mergeDeep } from './merge-deep';

describe('mergeDeep()', () => {
    // https://github.com/vendurehq/vendure/issues/2864
    it('should sync the order of sub relations', () => {
        const prefetched = new Order({
            lines: [
                {
                    id: 'line1',
                    sales: [new Sale({ id: 'sale-of-line-1' })],
                },
                {
                    id: 'line2',
                    sales: [new Sale({ id: 'sale-of-line-2' })],
                },
            ],
        });

        const hydrationFetched = new Order({
            lines: [
                {
                    id: 'line2',
                    productVariant: { id: 'variant-of-line-2' },
                },
                {
                    id: 'line1',
                    productVariant: { id: 'variant-of-line-1' },
                },
            ],
        });

        const merged = mergeDeep(prefetched, hydrationFetched);
        const line1 = merged.lines.find(l => l.id === 'line1');
        const line2 = merged.lines.find(l => l.id === 'line2');

        expect(line1?.sales[0].id).toBe('sale-of-line-1');
        expect(line1?.productVariant?.id).toBe('variant-of-line-1');
        expect(line2?.sales[0].id).toBe('sale-of-line-2');
        expect(line2?.productVariant?.id).toBe('variant-of-line-2');
    });

    // https://github.com/vendurehq/vendure/issues/4935
    // A source object shared by multiple targets (e.g. two order lines referencing the
    // same ProductVariant instance) must be merged into every referencing target, not
    // just the first. Previously the persistent `visited` set treated the shared
    // instance as a circular reference on its second encounter and skipped it.
    it('should merge a shared source instance into every referencing target', () => {
        const sharedVariant = {
            id: 9572,
            facetValues: [{ id: 1, code: '5kg', facet: { id: 7, code: 'weight' } }],
        };
        const hydrationFetched = [
            { id: 1, productVariant: sharedVariant },
            { id: 2, productVariant: sharedVariant },
        ];
        const prefetched = [
            { id: 1, productVariant: { id: 9572 } },
            { id: 2, productVariant: { id: 9572 } },
        ];

        const merged = mergeDeep(prefetched as any, hydrationFetched as any);

        // Both lines' variants must have the hydrated facetValues (incl. the nested facet)
        expect(merged[0].productVariant.facetValues?.[0].facet.code).toBe('weight');
        expect(merged[1].productVariant.facetValues?.[0].facet.code).toBe('weight');
    });

    it('should handle circular objects', () => {
        const first = {
            name: 'John',
            age: 30,
            address: {
                city: 'New York',
                zip: '10001',
            },
        };

        const second = {
            name: 'Jane',
            age: 25,
            address: {
                city: 'Los Angeles',
                zip: '90001',
            },
        };

        // @ts-ignore
        first.entity = first;
        // @ts-ignore
        second.entity = second;

        const merged = mergeDeep(first, second);

        expect(merged.name).toBe('Jane');
    });
});
