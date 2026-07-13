import {
    FieldNode,
    FragmentDefinitionNode,
    GraphQLResolveInfo,
    OperationDefinitionNode,
    parse,
} from 'graphql';
import { describe, expect, it } from 'vitest';

import { graphqlFields } from './graphql-fields';

/**
 * Parses a GraphQL document and produces a minimal `GraphQLResolveInfo`
 * shaped to match what `graphqlFields()` actually reads (`fieldNodes`,
 * `fragments`, `variableValues`). The "current resolver's field" is taken to
 * be the top-level selection of the operation — i.e. the test query
 * `query { user { ... } }` simulates resolving the `user` field.
 */
function buildInfo(source: string, variableValues: Record<string, unknown> = {}): GraphQLResolveInfo {
    const doc = parse(source);
    const operation = doc.definitions.find(
        d => d.kind === 'OperationDefinition',
    ) as OperationDefinitionNode;
    const fragments = Object.fromEntries(
        doc.definitions
            .filter(d => d.kind === 'FragmentDefinition')
            .map(d => {
                const f = d as FragmentDefinitionNode;
                return [f.name.value, f];
            }),
    );
    const topField = operation.selectionSet.selections[0] as FieldNode;
    return {
        fieldNodes: [topField],
        fragments,
        variableValues,
    } as unknown as GraphQLResolveInfo;
}

describe('graphqlFields', () => {
    it('returns the selected fields of a flat query', () => {
        const info = buildInfo(`{ user { id name email } }`);
        expect(graphqlFields(info)).toEqual({ id: {}, name: {}, email: {} });
    });

    it('returns nested selections recursively', () => {
        const info = buildInfo(`{ user { id orders { code total customer { name } } } }`);
        expect(graphqlFields(info)).toEqual({
            id: {},
            orders: { code: {}, total: {}, customer: { name: {} } },
        });
    });

    it('returns an empty object for an empty selection (no sub-fields)', () => {
        const info = buildInfo(`{ user }`);
        expect(graphqlFields(info)).toEqual({});
    });

    it('expands inline fragments', () => {
        const info = buildInfo(`{ user { id ... on User { name email } } }`);
        expect(graphqlFields(info)).toEqual({ id: {}, name: {}, email: {} });
    });

    it('expands fragment spreads', () => {
        const info = buildInfo(`
            { user { id ...UserDetails } }
            fragment UserDetails on User { name email }
        `);
        expect(graphqlFields(info)).toEqual({ id: {}, name: {}, email: {} });
    });

    it('merges fields that appear across multiple fragments', () => {
        const info = buildInfo(`
            { user { ...A ...B } }
            fragment A on User { orders { code } }
            fragment B on User { orders { total } }
        `);
        expect(graphqlFields(info)).toEqual({ orders: { code: {}, total: {} } });
    });

    it('skips fields with @skip(if: true)', () => {
        const info = buildInfo(`{ user { id name @skip(if: true) } }`);
        expect(graphqlFields(info)).toEqual({ id: {} });
    });

    it('keeps fields with @skip(if: false)', () => {
        const info = buildInfo(`{ user { id name @skip(if: false) } }`);
        expect(graphqlFields(info)).toEqual({ id: {}, name: {} });
    });

    it('keeps fields with @include(if: true)', () => {
        const info = buildInfo(`{ user { id name @include(if: true) } }`);
        expect(graphqlFields(info)).toEqual({ id: {}, name: {} });
    });

    it('skips fields with @include(if: false)', () => {
        const info = buildInfo(`{ user { id name @include(if: false) } }`);
        expect(graphqlFields(info)).toEqual({ id: {} });
    });

    it('resolves @skip directives against variables', () => {
        const source = `query ($hide: Boolean!) { user { id name @skip(if: $hide) } }`;
        expect(graphqlFields(buildInfo(source, { hide: true }))).toEqual({ id: {} });
        expect(graphqlFields(buildInfo(source, { hide: false }))).toEqual({ id: {}, name: {} });
    });

    it('resolves @include directives against variables', () => {
        const source = `query ($show: Boolean!) { user { id name @include(if: $show) } }`;
        expect(graphqlFields(buildInfo(source, { show: false }))).toEqual({ id: {} });
        expect(graphqlFields(buildInfo(source, { show: true }))).toEqual({ id: {}, name: {} });
    });

    it('skips an inline fragment with @skip(if: true)', () => {
        const info = buildInfo(`{ user { id ... on User @skip(if: true) { name email } } }`);
        expect(graphqlFields(info)).toEqual({ id: {} });
    });

    it('skips a fragment spread with @skip(if: true)', () => {
        const info = buildInfo(`
            { user { id ...UserDetails @skip(if: true) } }
            fragment UserDetails on User { name email }
        `);
        expect(graphqlFields(info)).toEqual({ id: {} });
    });

    it('handles a paginated-list style query (the Vendure @Relations() shape)', () => {
        // Mimics the shape `@Relations()` reads when isPaginatedListQuery(info)
        // is true: it pulls `fields.items` from the result. Verifies the
        // outer structure is what relations.decorator.ts expects.
        const info = buildInfo(`
            {
                products {
                    items {
                        id
                        name
                        featuredAsset { source }
                        variants { id price }
                    }
                    totalItems
                }
            }
        `);
        expect(graphqlFields(info)).toEqual({
            items: {
                id: {},
                name: {},
                featuredAsset: { source: {} },
                variants: { id: {}, price: {} },
            },
            totalItems: {},
        });
    });
});
