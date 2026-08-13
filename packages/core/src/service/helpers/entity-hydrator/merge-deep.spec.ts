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

    // https://github.com/vendurehq/vendure/issues/4955 (OSS-642)
    // A target relation array can contain undefined holes (e.g. surcharges / payments /
    // shippingLines after OrderPlacedEvent). The id-based reordering must not dereference
    // those holes — otherwise mergeDeep throws `Cannot read properties of undefined`,
    // crashing EntityHydrator.hydrate() and (via EmailPlugin loadData) silently dropping
    // the order-confirmation email.
    it('should not crash when the target array has an undefined leading element', () => {
        const a = [undefined, { id: 2, name: 'B' }];
        const b = [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
        ];

        let merged: any;
        expect(() => (merged = mergeDeep(a as any, b as any))).not.toThrow();
        expect(merged[0].id).toBe(1);
        expect(merged[1].id).toBe(2);
    });

    it('should not crash when the target array has an undefined element in the middle', () => {
        const a = [{ id: 1, name: 'A' }, undefined, { id: 3, name: 'C' }];
        const b = [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
            { id: 3, name: 'C' },
        ];

        let merged: any;
        expect(() => (merged = mergeDeep(a as any, b as any))).not.toThrow();
        expect(merged[0].id).toBe(1);
        expect(merged[1].id).toBe(2);
        expect(merged[2].id).toBe(3);
    });

    // https://github.com/vendurehq/vendure/issues/5083
    it('should merge each object once rather than once per path', () => {
        const depth = 22;
        // `depth + 2` distinct objects, 2 ^ (depth + 1) distinct paths to the leaf, no cycles.
        const layeredDiamond = (leaf: object) => {
            let shared: any = leaf;
            for (let i = 0; i < depth; i++) {
                shared = { id: `level-${i}`, left: shared, right: shared, value: 'x' };
            }
            return { id: 'root', a: shared, b: shared };
        };
        let leafMerges = 0;
        // mergeDeep() enumerates the source once per merge, so this is one `ownKeys` per merge.
        // Changing how the source is enumerated invalidates the count. Throwing rather than
        // counting up stops a regression here from working through the other paths to the leaf first.
        const countedLeaf = new Proxy(
            { id: 'leaf', value: 'x' },
            {
                ownKeys(leaf) {
                    if (++leafMerges > 1) {
                        throw new Error('the shared leaf was merged more than once');
                    }
                    return Reflect.ownKeys(leaf);
                },
            },
        );

        mergeDeep(layeredDiamond({ id: 'leaf', value: 'x' }), layeredDiamond(countedLeaf));

        expect(leafMerges).toBe(1);
    });

    // Each target keeps its own pre-existing data when a shared source is merged into several of them.
    it('should keep the existing data of every target a shared source is merged into', () => {
        const sharedSource = { id: 'shared', facet: { id: 7, code: 'weight' } };
        const source = { left: { child: sharedSource }, right: { child: sharedSource } };
        const target = {
            left: { child: { id: 'shared', existing: 'left' } },
            right: { child: { id: 'shared', existing: 'right' } },
        };

        const merged = mergeDeep(target as any, source as any);

        expect(merged.left.child.facet.code).toBe('weight');
        expect(merged.right.child.facet.code).toBe('weight');
        expect(merged.left.child.existing).toBe('left');
        expect(merged.right.child.existing).toBe('right');
    });

    // A pair left partial by the cycle guard stays mergeable via a route that avoids the cycle.
    it('should complete a pair whose first merge was cut short by the cycle guard', () => {
        const parent: any = { id: 'parent', tag: 'p' };
        const child: any = { id: 'child', tag: 'c', parent };
        parent.child = child;
        const source = { viaParent: parent, direct: { child } };

        const existingChild = { id: 'child', existing: 'yes' };
        const target = {
            viaParent: { id: 'parent', child: existingChild },
            direct: { child: existingChild },
        };

        const merged = mergeDeep(target as any, source as any);

        expect(merged.direct.child.parent.id).toBe('parent');
        expect(merged.direct.child.existing).toBe('yes');
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
