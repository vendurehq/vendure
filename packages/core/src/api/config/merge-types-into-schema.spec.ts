import { describe, expect, it } from 'vitest';

import { mergeTypesIntoSchema } from './merge-types-into-schema';

// Using require right now to force the commonjs version of GraphQL to be used
// when running vitest tests. See https://github.com/vitejs/vite/issues/7879
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildSchema, printType, GraphQLEnumType, GraphQLInputObjectType, GraphQLString } = require('graphql');
/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('mergeTypesIntoSchema()', () => {
    it('adds new types to the schema', () => {
        const schema = buildSchema(`
            type Query {
                foo: String
            }
        `);
        const newInput = new GraphQLInputObjectType({
            name: 'NewInput',
            fields: { name: { type: GraphQLString } },
        });

        const result = mergeTypesIntoSchema(schema, [newInput]);

        expect(result.getType('NewInput')).toBeDefined();
        expect(printType(result.getType('NewInput')!)).toBe(`input NewInput {\n  name: String\n}`);
        expect(result.getQueryType()!.getFields().foo).toBeDefined();
    });

    it('replaces an existing type of the same name and rewires references to it', () => {
        const schema = buildSchema(`
            type Query {
                search(input: SearchInput!): String
            }

            input SearchInput
        `);
        const replacement = new GraphQLInputObjectType({
            name: 'SearchInput',
            fields: { term: { type: GraphQLString } },
        });

        const result = mergeTypesIntoSchema(schema, [replacement]);

        const inputType = result.getType('SearchInput') as any;
        expect(Object.keys(inputType.getFields())).toEqual(['term']);
        const argType = result.getQueryType()!.getFields().search.args[0].type as any;
        expect(argType.ofType).toBe(inputType);
    });

    it('adds types from additional schemas, with the main schema winning on name conflicts', () => {
        const schema = buildSchema(`
            type Query {
                foo: String
            }

            input Shared {
                fromMain: String
            }
        `);
        const additional = buildSchema(`
            input Extra {
                token: String!
            }

            input Shared {
                fromAdditional: String
            }
        `);

        const result = mergeTypesIntoSchema(schema, [], [additional]);

        expect(result.getType('Extra')).toBeDefined();
        const shared = result.getType('Shared') as any;
        expect(Object.keys(shared.getFields())).toEqual(['fromMain']);
    });

    it('does not copy introspection types from additional schemas', () => {
        const schema = buildSchema(`
            type Query {
                foo: String
            }
        `);
        const additional = buildSchema(`
            input Extra {
                token: String!
            }
        `);

        const result = mergeTypesIntoSchema(schema, [], [additional]);

        const nonIntrospectionDuplicates = Object.keys(result.getTypeMap()).filter(
            name =>
                name.startsWith('__') &&
                !name.match(
                    /^__(Schema|Type|TypeKind|Field|InputValue|EnumValue|Directive|DirectiveLocation)$/,
                ),
        );
        expect(nonIntrospectionDuplicates).toEqual([]);
    });

    it('preserves query, mutation and subscription root types', () => {
        const schema = buildSchema(`
            type Query {
                foo: String
            }

            type Mutation {
                doIt: Boolean
            }

            type Subscription {
                onIt: Boolean
            }
        `);
        const replacement = new GraphQLEnumType({
            name: 'NewEnum',
            values: { A: { value: 0 } },
        });

        const result = mergeTypesIntoSchema(schema, [replacement]);

        expect(result.getQueryType()!.name).toBe('Query');
        expect(result.getMutationType()!.name).toBe('Mutation');
        expect(result.getSubscriptionType()!.name).toBe('Subscription');
    });
});
