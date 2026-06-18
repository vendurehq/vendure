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
