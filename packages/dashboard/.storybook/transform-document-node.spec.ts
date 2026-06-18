import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { transformDocumentNodeInSource } from './transform-document-node.js';

describe('transformDocumentNodeInSource', () => {
    it('should transform an inline query DocumentNode', () => {
        const source = `queryDocument={{
    kind: 'Document',
    definitions: [...]
}}`;
        const mockDocNode = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'query',
                    name: { kind: 'Name', value: 'Product' },
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [
                            {
                                kind: 'Field',
                                name: { kind: 'Name', value: 'product' },
                                selectionSet: {
                                    kind: 'SelectionSet',
                                    selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
        };

        const storyContext = {
            args: {
                queryDocument: mockDocNode,
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        expect(result).toContain('queryDocument={graphql`');
        expect(result).toContain('query Product');
        expect(result).toContain('product');
        expect(result).toContain('id');
        expect(result).toContain('name');
        expect(result).toContain('`}');
    });

    it('should transform multiple inline DocumentNodes', () => {
        const source = `queryDocument={{
    kind: 'Document',
    definitions: [...]
}} updateDocument={{
    kind: 'Document',
    definitions: [...]
}}`;
        const mockQueryDoc = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'query',
                    name: { kind: 'Name', value: 'Product' },
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'product' } }],
                    },
                },
            ],
        };

        const mockUpdateDoc = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'mutation',
                    name: { kind: 'Name', value: 'UpdateProduct' },
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'updateProduct' } }],
                    },
                },
            ],
        };

        const storyContext = {
            args: {
                queryDocument: mockQueryDoc,
                updateDocument: mockUpdateDoc,
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        expect(result).toContain('queryDocument={graphql`');
        expect(result).toContain('query Product');
        expect(result).toContain('updateDocument={graphql`');
        expect(result).toContain('mutation UpdateProduct');
    });

    it('should handle inline fragments', () => {
        const source = `fragment={{
    kind: 'Document',
    definitions: [...]
}}`;
        const mockFragmentDoc = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'FragmentDefinition',
                    name: { kind: 'Name', value: 'ProductDetail' },
                    typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Product' } },
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                        ],
                    },
                },
            ],
        };

        const storyContext = {
            args: {
                fragment: mockFragmentDoc,
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        expect(result).toContain('fragment={graphql`');
        expect(result).toContain('fragment ProductDetail on Product');
    });

    it('should not transform if storyContext is missing', () => {
        const source = 'queryDocument={productQuery}';
        const result = transformDocumentNodeInSource(source, undefined);

        expect(result).toBe(source);
    });

    it('should not transform if args are missing', () => {
        const source = 'queryDocument={productQuery}';
        const storyContext = {};
        const result = transformDocumentNodeInSource(source, storyContext);

        expect(result).toBe(source);
    });

    it('should not transform if the arg is not a DocumentNode', () => {
        const source = `queryDocument={{
    kind: 'Document',
    definitions: [...]
}}`;
        const storyContext = {
            args: {
                queryDocument: 'not a document node',
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        expect(result).toBe(source);
    });

    it('should not transform if DocumentNode is invalid (missing kind)', () => {
        const source = `queryDocument={{
    definitions: [...]
}}`;
        const storyContext = {
            args: {
                queryDocument: {
                    definitions: [],
                },
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        expect(result).toBe(source);
    });

    it('should not transform if DocumentNode has no definitions', () => {
        const source = `queryDocument={{
    kind: 'Document',
    definitions: []
}}`;
        const storyContext = {
            args: {
                queryDocument: {
                    kind: 'Document',
                    definitions: [],
                },
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        expect(result).toBe(source);
    });

    it('should preserve non-DocumentNode props in source', () => {
        const source = `pageId="test" queryDocument={{
    kind: 'Document',
    definitions: [...]
}} title="Product"`;
        const mockDocNode = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'query',
                    name: { kind: 'Name', value: 'Product' },
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'product' } }],
                    },
                },
            ],
        };

        const storyContext = {
            args: {
                queryDocument: mockDocNode,
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        expect(result).toContain('pageId="test"');
        expect(result).toContain('title="Product"');
        expect(result).toContain('queryDocument={graphql`');
    });

    it('should handle inline mutations', () => {
        const source = `deleteMutation={{
    kind: 'Document',
    definitions: [...]
}}`;
        const mockMutationDoc = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'mutation',
                    name: { kind: 'Name', value: 'DeleteProduct' },
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'deleteProduct' } }],
                    },
                },
            ],
        };

        const storyContext = {
            args: {
                deleteMutation: mockMutationDoc,
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        expect(result).toContain('deleteMutation={graphql`');
        expect(result).toContain('mutation DeleteProduct');
    });

    it('should format SDL with proper indentation', () => {
        const source = `queryDocument={{
    kind: 'Document',
    definitions: [...]
}}`;
        const mockDocNode = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'query',
                    name: { kind: 'Name', value: 'Product' },
                    variableDefinitions: [
                        {
                            kind: 'VariableDefinition',
                            variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                        },
                    ],
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [
                            {
                                kind: 'Field',
                                name: { kind: 'Name', value: 'product' },
                                arguments: [
                                    {
                                        kind: 'Argument',
                                        name: { kind: 'Name', value: 'id' },
                                        value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                                    },
                                ],
                                selectionSet: {
                                    kind: 'SelectionSet',
                                    selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
        };

        const storyContext = {
            args: {
                queryDocument: mockDocNode,
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        // Check that indentation is present (4 spaces for base indentation)
        expect(result).toMatch(/\n {4}query Product/);
        expect(result).toMatch(/\n {4}/);
    });

    it('should not transform if source does not match inline pattern', () => {
        const source = 'queryDocument={someVariable}';
        const storyContext = {
            args: {
                queryDocument: {
                    kind: 'Document',
                    definitions: [
                        {
                            kind: 'OperationDefinition',
                            operation: 'query',
                            name: { kind: 'Name', value: 'Product' },
                        },
                    ],
                },
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        // Should not transform variable references, only inline objects
        expect(result).toBe(source);
    });

    it('should transform actual Storybook source format with variable names', () => {
        // This is the actual format from Storybook console logs
        const source = `<DetailPageStoryWrapper
  pageId="product-detail"
  queryDocument={productQuery}
  updateDocument={updateProductDocument}
  title={entity => entity?.name || 'Product'}
  setValuesForUpdate={entity => ({
    id: entity.id,
    name: entity.name
  })}
/>`;

        const mockProductQuery = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'query',
                    name: { kind: 'Name', value: 'Product' },
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [
                            {
                                kind: 'Field',
                                name: { kind: 'Name', value: 'product' },
                                selectionSet: {
                                    kind: 'SelectionSet',
                                    selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
        };

        const mockUpdateDocument = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'mutation',
                    name: { kind: 'Name', value: 'UpdateProduct' },
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'updateProduct' } }],
                    },
                },
            ],
        };

        const storyContext = {
            args: {
                queryDocument: mockProductQuery,
                updateDocument: mockUpdateDocument,
            },
        };

        const result = transformDocumentNodeInSource(source, storyContext);

        // Should transform both queryDocument and updateDocument
        expect(result).toContain('queryDocument={graphql`');
        expect(result).toContain('query Product');
        expect(result).toContain('updateDocument={graphql`');
        expect(result).toContain('mutation UpdateProduct');
        expect(result).not.toContain('productQuery');
        expect(result).not.toContain('updateProductDocument');
    });

    it('should transform EXACT Storybook inline source format from actual console logs', () => {
        // Load the exact source from the actual Storybook output
        const actualSource = readFileSync(
            resolve(__dirname, 'fixtures/detail-page-storybook-source.fixture.txt'),
            'utf-8',
        );

        // Create mock DocumentNode objects that match the structure
        const mockQueryDoc = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'query',
                    name: { kind: 'Name', value: 'Product' },
                    variableDefinitions: [
                        {
                            kind: 'VariableDefinition',
                            variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            type: {
                                kind: 'NonNullType',
                                type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                            },
                        },
                    ],
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [
                            {
                                kind: 'Field',
                                name: { kind: 'Name', value: 'product' },
                                arguments: [
                                    {
                                        kind: 'Argument',
                                        name: { kind: 'Name', value: 'id' },
                                        value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                                    },
                                ],
                                selectionSet: {
                                    kind: 'SelectionSet',
                                    selections: [
                                        {
                                            kind: 'FragmentSpread',
                                            name: { kind: 'Name', value: 'ProductDetail' },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                },
                {
                    kind: 'FragmentDefinition',
                    name: { kind: 'Name', value: 'ProductDetail' },
                    typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Product' } },
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'slug' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'enabled' } },
                            {
                                kind: 'Field',
                                name: { kind: 'Name', value: 'featuredAsset' },
                                selectionSet: {
                                    kind: 'SelectionSet',
                                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                },
                            },
                            {
                                kind: 'Field',
                                name: { kind: 'Name', value: 'assets' },
                                selectionSet: {
                                    kind: 'SelectionSet',
                                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                },
                            },
                            {
                                kind: 'Field',
                                name: { kind: 'Name', value: 'facetValues' },
                                selectionSet: {
                                    kind: 'SelectionSet',
                                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                },
                            },
                            {
                                kind: 'Field',
                                name: { kind: 'Name', value: 'translations' },
                                selectionSet: {
                                    kind: 'SelectionSet',
                                    selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'languageCode' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'slug' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
        };

        const mockUpdateDoc = {
            kind: 'Document',
            definitions: [
                {
                    kind: 'OperationDefinition',
                    operation: 'mutation',
                    name: { kind: 'Name', value: 'UpdateProduct' },
                    variableDefinitions: [
                        {
                            kind: 'VariableDefinition',
                            variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            type: {
                                kind: 'NonNullType',
                                type: {
                                    kind: 'NamedType',
                                    name: { kind: 'Name', value: 'UpdateProductInput' },
                                },
                            },
                        },
                    ],
                    selectionSet: {
                        kind: 'SelectionSet',
                        selections: [
                            {
                                kind: 'Field',
                                name: { kind: 'Name', value: 'updateProduct' },
                                arguments: [
                                    {
                                        kind: 'Argument',
                                        name: { kind: 'Name', value: 'input' },
                                        value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                                    },
                                ],
                                selectionSet: {
                                    kind: 'SelectionSet',
                                    selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'slug' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'enabled' } },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
        };

        const storyContext = {
            args: {
                queryDocument: mockQueryDoc,
                updateDocument: mockUpdateDoc,
            },
        };

        const result = transformDocumentNodeInSource(actualSource, storyContext);

        // Verify transformation occurred
        expect(result).not.toBe(actualSource);
        expect(result).toContain('queryDocument={graphql`');
        expect(result).toContain('query Product($id: ID!)');
        expect(result).toContain('fragment ProductDetail on Product');
        expect(result).toContain('updateDocument={graphql`');
        expect(result).toContain('mutation UpdateProduct($input: UpdateProductInput!)');

        // Verify inline objects were replaced
        expect(result).not.toContain('definitions: [');
        expect(result).not.toContain("kind: 'Document'");
        expect(result).not.toContain('loc: undefined');
    });
});
