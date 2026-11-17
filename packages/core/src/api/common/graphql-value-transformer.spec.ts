import { buildSchema, GraphQLObjectType, GraphQLSchema, parse } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';

import { GraphqlValueTransformer } from './graphql-value-transformer';

describe('GraphqlValueTransformer', () => {
    describe('getArgumentTypeTree()', () => {
        let schema: GraphQLSchema;
        let transformer: GraphqlValueTransformer;

        beforeEach(() => {
            schema = buildSchema(`
                input A {
                    id: ID
                    b: B
                }
                input B {
                    id: ID
                    a: A
                }
                input Filter {
                    id: ID
                    _and: [Filter!]
                    _or: [Filter!]
                }
                type Query {
                    recursive(input: A): Boolean
                    filter(filter: Filter): Boolean
                }
            `);
            transformer = new GraphqlValueTransformer(schema);
        });

        function markIds(fieldName: string, args: Record<string, any>) {
            const field = (schema.getType('Query') as GraphQLObjectType).getFields()[fieldName];
            const typeTree = transformer.getArgumentTypeTree(field);
            transformer.transformValues(typeTree, args, (value, type) =>
                type?.name === 'ID' ? `decoded:${String(value)}` : value,
            );
            return args;
        }

        // #5511 — `getArgumentTypeTree()` builds the tree for every argument of the field, so a cycle
        // between input types must not overflow the stack. The depth is the number of fields on the path
        // whose type already appears earlier on the path. IDs are decoded until the depth exceeds 3.
        it('handles mutually recursive input types', () => {
            const result = markIds('recursive', {
                input: { id: '1', b: { id: '2', a: { id: '3', b: { a: { id: '5', b: { id: '6' } } } } } },
            });

            expect(result).toEqual({
                input: {
                    id: 'decoded:1',
                    b: {
                        id: 'decoded:2',
                        a: { id: 'decoded:3', b: { a: { id: 'decoded:5', b: { id: '6' } } } },
                    },
                },
            });
        });

        it('decodes ids nested in _and and _or', () => {
            const result = markIds('filter', {
                filter: { _and: [{ id: '1' }, { _or: [{ id: '2' }] }] },
            });

            expect(result).toEqual({
                filter: { _and: [{ id: 'decoded:1' }, { _or: [{ id: 'decoded:2' }] }] },
            });
        });
    });

    describe('getOutputTypeTree()', () => {
        let transformer: GraphqlValueTransformer;

        beforeEach(() => {
            const schema = buildSchema(`
                type Job {
                    id: ID!
                }
                type Product {
                    id: ID!
                    job: Job
                }
                type Query {
                    product: Product
                    jobs: [Job!]!
                }
            `);
            transformer = new GraphqlValueTransformer(schema);
        });

        function markIdsWithParentType(query: string, data: Record<string, any>) {
            const typeTree = transformer.getOutputTypeTree(parse(query));
            transformer.transformValues(typeTree, data, (value, type, parentType) =>
                type?.name === 'ID' ? `${parentType?.name ?? 'unknown'}:${String(value)}` : value,
            );
            return data;
        }

        // #5558 — the IdCodecPlugin uses the parent type to identify Job ids
        it('passes the parent type of a field to the visitor', () => {
            const result = markIdsWithParentType(`{ product { id job { id } } jobs { id } }`, {
                product: { id: '1', job: { id: '2' } },
                jobs: [{ id: '3' }],
            });

            expect(result).toEqual({
                product: { id: 'Product:1', job: { id: 'Job:2' } },
                jobs: [{ id: 'Job:3' }],
            });
        });

        it('passes the parent type of fields in named and inline fragments', () => {
            const result = markIdsWithParentType(
                `
                    query { product { ...ProductFields } jobs { ... on Job { id } } }
                    fragment ProductFields on Product { id job { ...JobFields } }
                    fragment JobFields on Job { id }
                `,
                {
                    product: { id: '1', job: { id: '2' } },
                    jobs: [{ id: '3' }],
                },
            );

            expect(result).toEqual({
                product: { id: 'Product:1', job: { id: 'Job:2' } },
                jobs: [{ id: 'Job:3' }],
            });
        });
    });
});
