import { graphql } from 'gql.tada';
import { describe, expect, it, vi } from 'vitest';

import {
    getFieldsFromDocumentNode,
    getListQueryFields,
    getOperationVariablesFields,
} from './get-document-structure.js';

vi.mock('virtual:admin-api-schema', () => {
    return import('./testing-utils.js').then(m => m.getMockSchemaInfo());
});

describe('getListQueryFields', () => {
    it('should extract fields from a simple paginated list query', () => {
        const doc = graphql(`
            query {
                products {
                    items {
                        id
                        name
                    }
                }
            }
        `);

        const fields = getListQueryFields(doc);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'name',
                nullable: false,
                type: 'String',
            },
        ]);
    });

    it('should handle a fragment of the main entity in the query', () => {
        const doc = graphql(`
            query {
                products {
                    items {
                        ...ProductFields
                    }
                }
            }

            fragment ProductFields on Product {
                id
                name
            }
        `);

        const fields = getListQueryFields(doc);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'name',
                nullable: false,
                type: 'String',
            },
        ]);
    });

    it('should handle a fragment of a nested entity in the query', () => {
        const doc = graphql(/* graphql*/ `
            query {
                products {
                    items {
                        id
                        featuredAsset {
                            ...Asset
                        }
                    }
                }
            }

            fragment Asset on Asset {
                preview
            }
        `);

        const fields = getListQueryFields(doc);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
            },
            {
                isPaginatedList: false,
                isScalar: false,
                list: false,
                name: 'featuredAsset',
                nullable: true,
                type: 'Asset',
            },
        ]);
    });

    it('should return empty array for non-paginated queries', () => {
        const doc = graphql(`
            query {
                product {
                    id
                }
            }
        `);

        const fields = getListQueryFields(doc);
        expect(fields).toEqual([]);
    });

    it('should handle empty items selection set', () => {
        const doc = graphql(`
            query {
                products {
                    totalItems
                }
            }
        `);

        const fields = getListQueryFields(doc);
        expect(fields).toEqual([]);
    });

    it('should handle a fragment of a nested entity in the query', () => {
        const doc = graphql(/* graphql*/ `
            query GetCollectionWithProductVariants {
                collection {
                    id
                    name
                    productVariants {
                        items {
                            id
                            sku
                        }
                        totalItems
                    }
                }
            }
        `);

        const fields = getListQueryFields(doc);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'sku',
                nullable: false,
                type: 'String',
            },
        ]);
    });
});

describe('getOperationVariablesFields', () => {
    it('should extract fields from a simple mutation', () => {
        const doc = graphql(`
            mutation UpdateProduct($input: UpdateProductInput!) {
                updateProduct(input: $input) {
                    ...ProductDetail
                }
            }

            fragment ProductDetail on Product {
                id
                name
            }
        `);

        const fields = getOperationVariablesFields(doc, 'input');
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
                typeInfo: undefined,
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'name',
                nullable: false,
                type: 'String',
                typeInfo: undefined,
            },
        ]);
    });

    it('should handle a mutation with a nested input', () => {
        const doc = graphql(`
            mutation AdjustDraftOrderLine($orderId: ID!, $input: AdjustDraftOrderLineInput!) {
                adjustDraftOrderLine(orderId: $orderId, input: $input) {
                    id
                    lines {
                        id
                    }
                }
            }
        `);

        const fields = getOperationVariablesFields(doc, undefined);
        expect(fields).toEqual([
            {
                name: 'orderId',
                isPaginatedList: false,
                isScalar: true,
                list: false,
                nullable: false,
                type: 'ID',
                typeInfo: undefined,
            },
            {
                name: 'input',
                isPaginatedList: false,
                isScalar: false,
                list: false,
                nullable: true,
                type: 'AdjustDraftOrderLineInput',
                typeInfo: [
                    {
                        name: 'orderLineId',
                        isPaginatedList: false,
                        isScalar: true,
                        list: false,
                        nullable: false,
                        type: 'ID',
                        typeInfo: undefined,
                    },
                    {
                        name: 'quantity',
                        isPaginatedList: false,
                        isScalar: true,
                        list: false,
                        nullable: false,
                        type: 'Int',
                        typeInfo: undefined,
                    },
                ],
            },
        ]);
    });
});

describe('getFieldsFromDocumentNode', () => {
    it('should extract fields from a simple path', () => {
        const doc = graphql(`
            query {
                order(id: "1") {
                    id
                    lines {
                        id
                        quantity
                    }
                }
            }
        `);

        const fields = getFieldsFromDocumentNode(doc, ['order', 'lines']);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'quantity',
                nullable: false,
                type: 'Int',
            },
        ]);
    });

    it('should extract fields from root level', () => {
        const doc = graphql(`
            query {
                product {
                    id
                    name
                    description
                }
            }
        `);

        const fields = getFieldsFromDocumentNode(doc, ['product']);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'name',
                nullable: false,
                type: 'String',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'description',
                nullable: false,
                type: 'String',
            },
        ]);
    });

    it('should handle fragments in the target selection', () => {
        const doc = graphql(`
            query {
                product {
                    id
                    featuredAsset {
                        ...AssetFields
                    }
                }
            }

            fragment AssetFields on Asset {
                id
                name
                preview
            }
        `);

        const fields = getFieldsFromDocumentNode(doc, ['product', 'featuredAsset']);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'name',
                nullable: false,
                type: 'String',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'preview',
                nullable: false,
                type: 'String',
            },
        ]);
    });

    it('should handle deep nested paths', () => {
        const doc = graphql(`
            query {
                product {
                    variants {
                        prices {
                            currencyCode
                            price
                        }
                    }
                }
            }
        `);

        const fields = getFieldsFromDocumentNode(doc, ['product', 'variants', 'prices']);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'currencyCode',
                nullable: false,
                type: 'CurrencyCode',
            },
            {
                isPaginatedList: false,
                isScalar: false,
                list: false,
                name: 'price',
                nullable: false,
                type: 'Money',
            },
        ]);
    });

    it('should throw error for non-existent field', () => {
        const doc = graphql(`
            query {
                product {
                    id
                }
            }
        `);

        expect(() => getFieldsFromDocumentNode(doc, ['product', 'nonExistentField'])).toThrow(
            'Field "nonExistentField" not found at path product.nonExistentField',
        );
    });

    it('should throw error for non-existent path', () => {
        const doc = graphql(`
            query {
                product {
                    id
                }
            }
        `);

        expect(() => getFieldsFromDocumentNode(doc, ['nonExistentProduct'])).toThrow(
            'Field "nonExistentProduct" not found at path nonExistentProduct',
        );
    });

    it('should throw error when field has no selection set but path continues', () => {
        const doc = graphql(`
            query {
                product {
                    id
                }
            }
        `);

        expect(() => getFieldsFromDocumentNode(doc, ['product', 'id', 'something'])).toThrow(
            'Field "id" has no selection set but path continues',
        );
    });

    it('should handle empty selection set', () => {
        const doc = graphql(`
            query {
                product {
                    id
                    name
                }
            }
        `);

        // Test with a path that leads to a field with no selection set
        expect(() => getFieldsFromDocumentNode(doc, ['product', 'id', 'something'])).toThrow(
            'Field "id" has no selection set but path continues',
        );
    });

    it('should handle mixed field types and fragments', () => {
        const doc = graphql(`
            query {
                product {
                    id
                    featuredAsset {
                        ...AssetFields
                        fileSize
                    }
                }
            }

            fragment AssetFields on Asset {
                id
                name
            }
        `);

        const fields = getFieldsFromDocumentNode(doc, ['product', 'featuredAsset']);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'name',
                nullable: false,
                type: 'String',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'fileSize',
                nullable: false,
                type: 'Int',
            },
        ]);
    });

    it('should handle fields within fragment spreads', () => {
        const doc = graphql(`
            query {
                order {
                    ...OrderFields
                }
            }

            fragment OrderFields on Order {
                id
                lines {
                    id
                    quantity
                }
            }
        `);

        const fields = getFieldsFromDocumentNode(doc, ['order', 'lines']);
        expect(fields).toEqual([
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'id',
                nullable: false,
                type: 'ID',
            },
            {
                isPaginatedList: false,
                isScalar: true,
                list: false,
                name: 'quantity',
                nullable: false,
                type: 'Int',
            },
        ]);
    });
});
