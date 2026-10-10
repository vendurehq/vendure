import { buildSchema, GraphQLObjectType, GraphQLSchema } from 'graphql';
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
});
