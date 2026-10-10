import { buildSchema, GraphQLObjectType } from 'graphql';
import { describe, expect, it } from 'vitest';

import { GraphqlValueTransformer } from './graphql-value-transformer';

const schema = buildSchema(`
    type Query {
        dummy: String
    }
    type Mutation {
        updateProduct(input: UpdateProductInput!): String
        createProduct(input: CreateProductInput!): String
    }
    input UpdateProductInput {
        id: ID
        name: String
    }
    input CreateProductInput {
        name: String
    }
`);

describe('GraphqlValueTransformer.getInputTypeTreeForField()', () => {
    const transformer = new GraphqlValueTransformer(schema);
    const mutation = schema.getMutationType() as GraphQLObjectType;

    it('uses the resolved field argument type, not a sibling field with the same argument name', () => {
        const updateTree = transformer.getInputTypeTreeForField(mutation, 'updateProduct');
        const createTree = transformer.getInputTypeTreeForField(mutation, 'createProduct');

        expect(updateTree.operation.children.input.type?.name).toBe('UpdateProductInput');
        expect(updateTree.operation.children.input.children.id.type?.name).toBe('ID');
        expect(createTree.operation.children.input.type?.name).toBe('CreateProductInput');
        expect(createTree.operation.children.input.children.id).toBeUndefined();
    });

    it('decodes an ID from the field tree without an operation definition', () => {
        const updateTree = transformer.getInputTypeTreeForField(mutation, 'updateProduct');
        const data = { input: { id: 'T_1', name: 'A' } };

        transformer.transformValues(updateTree, data, (value, type) => {
            if (type?.name === 'ID') {
                return `decoded:${value}`;
            }
            return value;
        });

        expect(data.input.id).toBe('decoded:T_1');
        expect(data.input.name).toBe('A');
    });

    it('returns an empty tree when the field is not on the parent type', () => {
        const tree = transformer.getInputTypeTreeForField(mutation, 'missingField');
        expect(tree.operation.children).toEqual({});
    });
});
