import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { JoinAttribute } from 'typeorm/query-builder/JoinAttribute';
import { describe, expect, it } from 'vitest';

import { joinCoversRelation, RelationLoadNarrowingOptions } from './typeorm-duplicate-eager-load-fix';

describe('joinCoversRelation()', () => {
    function relation(overrides: Partial<RelationMetadata> = {}): RelationMetadata {
        return {
            isEager: true,
            propertyPath: 'productVariantPrices',
            inverseEntityMetadata: { eagerRelations: [] },
            ...overrides,
        } as RelationMetadata;
    }

    const eagerRelation = relation();

    function join(overrides: Partial<JoinAttribute> = {}): JoinAttribute {
        return {
            relation: eagerRelation,
            parentAlias: 'productvariant',
            direction: 'LEFT',
            condition: undefined,
            isSelected: true,
            ...overrides,
        } as JoinAttribute;
    }

    function covers(
        target: RelationMetadata,
        joins: JoinAttribute[],
        findOptions: RelationLoadNarrowingOptions = {},
    ) {
        return joinCoversRelation(target, joins, 'productvariant', findOptions);
    }

    it('covers a selected, unconditional LEFT join of the relation', () => {
        expect(covers(eagerRelation, [join()])).toBe(true);
    });

    it('does not cover when there is no join', () => {
        expect(covers(eagerRelation, [])).toBe(false);
    });

    it('does not cover a join of a different relation', () => {
        expect(covers(eagerRelation, [join({ relation: relation() })])).toBe(false);
    });

    it('does not cover a join from a different alias', () => {
        expect(covers(eagerRelation, [join({ parentAlias: 'other' })])).toBe(false);
    });

    it('does not cover an INNER join', () => {
        expect(covers(eagerRelation, [join({ direction: 'INNER' })])).toBe(false);
    });

    // A conditional join hydrates a subset of the relation, so the separate query still has to run.
    it('does not cover a join carrying an ON condition', () => {
        expect(covers(eagerRelation, [join({ condition: 'channel.id = :channelId' })])).toBe(false);
    });

    it('does not cover an unselected join', () => {
        expect(covers(eagerRelation, [join({ isSelected: false })])).toBe(false);
    });

    it('does not cover a relation which is not eager', () => {
        const target = relation({ isEager: false });
        expect(covers(target, [join({ relation: target })])).toBe(false);
    });

    // Only the separate query loads the related entity's own eager relations.
    it('does not cover a relation whose target has eager relations of its own', () => {
        const target = relation({ inverseEntityMetadata: { eagerRelations: [{}] } as any });
        expect(covers(target, [join({ relation: target })])).toBe(false);
    });

    it.each(['select', 'order', 'relations'] as const)(
        'does not cover a relation the find options narrow through "%s"',
        key => {
            expect(
                covers(eagerRelation, [join()], { [key]: { productVariantPrices: { price: true } } }),
            ).toBe(false);
        },
    );

    it('covers a relation the find options merely name', () => {
        expect(covers(eagerRelation, [join()], { relations: { productVariantPrices: true } })).toBe(true);
    });

    it('covers a relation when the find options name an unrelated one', () => {
        expect(covers(eagerRelation, [join()], { relations: { featuredAsset: true } })).toBe(true);
    });

    it('reads a dotted property path out of the find options', () => {
        const nested = relation({ propertyPath: 'customFields.owner' });
        expect(
            covers(nested, [join({ relation: nested })], {
                relations: { customFields: { owner: { roles: true } } },
            }),
        ).toBe(false);
    });
});
