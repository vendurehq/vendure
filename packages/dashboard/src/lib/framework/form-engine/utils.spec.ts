import { graphql, VariablesOf } from 'gql.tada';
import { describe, expect, it } from 'vitest';

import { FieldInfo, getOperationVariablesFields } from '../document-introspection/get-document-structure.js';

import { ConfigurableFieldDef } from './form-engine-types.js';
import {
    convertEmptyStringsToNull,
    isFieldNullable,
    removeEmptyIdFields,
    stripNullNullableFields,
    stripUntouchedTranslations,
    transformRelationFields,
} from './utils.js';

const createProductDocument = graphql(`
    mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
        }
    }
`);

type CreateProductInput = VariablesOf<typeof createProductDocument>;

const updateProductDocument = graphql(`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`);

type UpdateProductInput = VariablesOf<typeof updateProductDocument>;

describe('removeEmptyIdFields', () => {
    it('should remove empty translation id field', () => {
        const values: CreateProductInput = {
            input: { translations: [{ id: '', languageCode: 'en' }] },
        };
        const fields = getOperationVariablesFields(createProductDocument);
        const result = removeEmptyIdFields(values, fields);

        expect(result).toEqual({ input: { translations: [{ languageCode: 'en' }] } });
    });

    it('should remove empty featuredAsset id field', () => {
        const values: CreateProductInput = {
            input: { featuredAssetId: '', translations: [] },
        };
        const fields = getOperationVariablesFields(createProductDocument);
        const result = removeEmptyIdFields(values, fields);
        expect(result).toEqual({ input: { translations: [] } });
    });
});

// https://github.com/vendurehq/vendure/issues/4885 (OSS-579)
// The form seeds a translation row per configured language; submitting the unfilled ones
// persists empty translation rows that break language fallback. stripUntouchedTranslations
// keeps a row when it is dirty OR persisted, and drops it otherwise.
//
// `dirtyFields` is react-hook-form's record of which fields differ from `defaultValues`; it is a
// nested object of booleans (a field the user changed is `true`). These tests feed it directly.
// On the create path dirty state carries the decision; on the update path nothing is dirty until
// the user types (RHF's `values` prop resets the form), so a persisted row is kept by its `id`
// instead. That the real form populates `dirtyFields` this way is covered by the e2e, not here.
describe('stripUntouchedTranslations', () => {
    const fields = () => getOperationVariablesFields(createProductDocument);

    it('drops an untouched seeded translation and keeps the touched ones', () => {
        const values: CreateProductInput = {
            input: {
                translations: [
                    { languageCode: 'en', name: 'Test product', slug: 'test-product', description: '' },
                    { languageCode: 'pl', name: '', slug: '', description: '' },
                ],
            },
        };
        const dirty = { input: { translations: [{ name: true, slug: true }, {}] } };
        const result = stripUntouchedTranslations(values, fields(), dirty);
        expect(result.input.translations).toEqual([
            { languageCode: 'en', name: 'Test product', slug: 'test-product', description: '' },
        ]);
    });

    it('keeps a row where any single field is dirty', () => {
        const values: CreateProductInput = {
            input: {
                translations: [{ languageCode: 'pl', name: '', slug: 'polski-slug', description: '' }],
            },
        };
        const dirty = { input: { translations: [{ slug: true }] } };
        const result = stripUntouchedTranslations(values, fields(), dirty);
        expect(result.input.translations).toEqual([
            { languageCode: 'pl', name: '', slug: 'polski-slug', description: '' },
        ]);
    });

    // The key advantage over a value-based check: a non-string field seeded with a filled-looking
    // default (`false`, `0`, an enum member) is still correctly dropped when untouched, because
    // dirty state doesn't care what the value is.
    it('drops an untouched row even when its values look non-empty', () => {
        const values: any = {
            input: {
                translations: [
                    { languageCode: 'en', name: 'Filled', enabled: true, count: 5 },
                    { languageCode: 'pl', name: '', enabled: false, count: 0 },
                ],
            },
        };
        const dirty = { input: { translations: [{ name: true, enabled: true, count: true }, {}] } };
        const result = stripUntouchedTranslations(values, fields(), dirty);
        expect(result.input.translations).toEqual([
            { languageCode: 'en', name: 'Filled', enabled: true, count: 5 },
        ]);
    });

    it('leaves values with no untouched translations unchanged', () => {
        const values: CreateProductInput = {
            input: {
                translations: [
                    { languageCode: 'en', name: 'Test product', slug: 'test-product', description: '' },
                ],
            },
        };
        const dirty = { input: { translations: [{ name: true, slug: true }] } };
        const result = stripUntouchedTranslations(values, fields(), dirty);
        expect(result).toEqual(values);
    });

    // If every row is untouched, dropping them all would submit `translations: []`. A blank create
    // form is reachable (a non-nullable `String` maps to a bare `z.string()`), so keep the rows and
    // let validation surface the empty required fields instead of silently sending none.
    it('keeps all rows when every one is untouched', () => {
        const values: CreateProductInput = {
            input: {
                translations: [
                    { languageCode: 'en', name: '', slug: '', description: '' },
                    { languageCode: 'pl', name: '', slug: '', description: '' },
                ],
            },
        };
        const dirty = { input: { translations: [{}, {}] } };
        const result = stripUntouchedTranslations(values, fields(), dirty);
        expect(result.input.translations).toEqual([
            { languageCode: 'en', name: '', slug: '', description: '' },
            { languageCode: 'pl', name: '', slug: '', description: '' },
        ]);
    });

    // The #4885 update scenario Will identified: on an update, react-hook-form's `values` prop
    // resets the form and promotes the entity to `defaultValues`, so *nothing* is dirty until the
    // user types. Editing only a non-translation field (e.g. toggling Enabled) leaves every
    // translation row untouched — the persisted `en` row is kept solely because it carries an `id`,
    // and the seeded empty `pl` row is dropped. Dirty state alone cannot tell them apart here; the
    // `id` is what separates them. (The old dirty-only version wrongly assumed the persisted row
    // would be dirty, which masked this bug.)
    it('on update, keeps the persisted (id-bearing) row and drops the seeded one when nothing is dirty', () => {
        const values: UpdateProductInput = {
            input: {
                id: '1',
                enabled: true,
                translations: [
                    { id: '10', languageCode: 'en', name: 'Laptop', slug: 'laptop', description: '' },
                    { languageCode: 'pl', name: '', slug: '', description: '' },
                ],
            },
        };
        // Only the top-level `enabled` toggle is dirty; no translation row is.
        const dirty = { input: { enabled: true, translations: [{}, {}] } };
        const result = stripUntouchedTranslations(
            values,
            getOperationVariablesFields(updateProductDocument),
            dirty,
        );
        expect(result.input.translations).toEqual([
            { id: '10', languageCode: 'en', name: 'Laptop', slug: 'laptop', description: '' },
        ]);
    });

    // Mixed update: the realistic multi-language edit — an untouched persisted row (kept by `id`),
    // a newly-typed row the user just added (kept because it is dirty, no `id` yet), and a seeded
    // untouched row (dropped). Exercises both keep-predicates together in one payload.
    it('on update, keeps untouched-persisted and newly-typed rows while dropping the seeded one', () => {
        const values: UpdateProductInput = {
            input: {
                id: '1',
                translations: [
                    { id: '10', languageCode: 'en', name: 'Laptop', slug: 'laptop', description: '' },
                    { id: '20', languageCode: 'de', name: 'Laptop DE', slug: 'laptop-de', description: '' },
                    { languageCode: 'fr', name: 'Ordinateur', slug: 'ordinateur', description: '' },
                    { languageCode: 'es', name: '', slug: '', description: '' },
                ],
            },
        };
        // Only the newly-typed `fr` row is dirty; the two persisted rows and the seeded `es` are not.
        const dirty = {
            input: { translations: [{}, {}, { name: true, slug: true }, {}] },
        };
        const result = stripUntouchedTranslations(
            values,
            getOperationVariablesFields(updateProductDocument),
            dirty,
        );
        expect(result.input.translations).toEqual([
            { id: '10', languageCode: 'en', name: 'Laptop', slug: 'laptop', description: '' },
            { id: '20', languageCode: 'de', name: 'Laptop DE', slug: 'laptop-de', description: '' },
            { languageCode: 'fr', name: 'Ordinateur', slug: 'ordinateur', description: '' },
        ]);
    });

    it('treats missing dirty info for a row as untouched', () => {
        const values: CreateProductInput = {
            input: {
                translations: [
                    { languageCode: 'en', name: 'Test product', slug: 'test-product', description: '' },
                    { languageCode: 'pl', name: '', slug: '', description: '' },
                ],
            },
        };
        // dirtyFields only carries an entry for the touched row; the untouched row is absent.
        const dirty = { input: { translations: [{ name: true }] } };
        const result = stripUntouchedTranslations(values, fields(), dirty);
        expect(result.input.translations).toEqual([
            { languageCode: 'en', name: 'Test product', slug: 'test-product', description: '' },
        ]);
    });

    it('does not mutate the input', () => {
        const values: CreateProductInput = {
            input: {
                translations: [
                    { languageCode: 'en', name: 'Test product', slug: 'test-product', description: '' },
                    { languageCode: 'pl', name: '', slug: '', description: '' },
                ],
            },
        };
        const snapshot = structuredClone(values);
        stripUntouchedTranslations(values, fields(), { input: { translations: [{ name: true }, {}] } });
        expect(values).toEqual(snapshot);
    });

    it('returns null input unchanged', () => {
        expect(stripUntouchedTranslations(null as any, fields(), {})).toBeNull();
    });
});

describe('transformRelationFields', () => {
    const createFieldsWithListRelation = (): FieldInfo[] => [
        {
            name: 'customFields',
            type: 'CustomFields',
            nullable: true,
            list: false,
            isPaginatedList: false,
            isScalar: false,
            typeInfo: [
                {
                    name: 'featuredProductsIds',
                    type: 'ID',
                    nullable: true,
                    list: true,
                    isPaginatedList: false,
                    isScalar: true,
                },
            ],
        },
    ];

    const createFieldsWithSingleRelation = (): FieldInfo[] => [
        {
            name: 'customFields',
            type: 'CustomFields',
            nullable: true,
            list: false,
            isPaginatedList: false,
            isScalar: false,
            typeInfo: [
                {
                    name: 'featuredProductId',
                    type: 'ID',
                    nullable: true,
                    list: false,
                    isPaginatedList: false,
                    isScalar: true,
                },
            ],
        },
    ];

    it('should extract IDs from list relation and delete original field', () => {
        const entity = {
            customFields: {
                featuredProducts: [
                    { id: '1', name: 'Product 1' },
                    { id: '2', name: 'Product 2' },
                ],
            },
        };
        const result = transformRelationFields(createFieldsWithListRelation(), entity);

        expect(result.customFields).toEqual({ featuredProductsIds: ['1', '2'] });
        expect(result.customFields).not.toHaveProperty('featuredProducts');
    });

    it('should handle empty array for clearing list relations', () => {
        const entity = { customFields: { featuredProducts: [] } };
        const result = transformRelationFields(createFieldsWithListRelation(), entity);

        expect(result.customFields).toEqual({ featuredProductsIds: [] });
    });

    it('should handle undefined list relation by not setting the field', () => {
        const undefinedResult = transformRelationFields(createFieldsWithListRelation(), { customFields: {} });

        expect(undefinedResult.customFields).not.toHaveProperty('featuredProductsIds');
    });

    it('should pass null through when list relation is explicitly cleared', () => {
        // Simulates clearing a relation: the form engine receives null from onChange,
        // which the static types don't model
        const nullResult = transformRelationFields(createFieldsWithListRelation(), {
            customFields: { featuredProducts: null } as any,
        });

        expect(nullResult.customFields.featuredProductsIds).toBeNull();
        expect(nullResult.customFields).not.toHaveProperty('featuredProducts');
    });

    it('should pass null through when single relation is explicitly cleared', () => {
        // Simulates clearing a relation: the form engine receives null from onChange,
        // which the static types don't model
        const result = transformRelationFields(createFieldsWithSingleRelation(), {
            customFields: { featuredProduct: null } as any,
        });

        expect(result.customFields.featuredProductId).toBeNull();
        expect(result.customFields).not.toHaveProperty('featuredProduct');
    });

    it('should extract ID from single relation and delete original field', () => {
        const entity = { customFields: { featuredProduct: { id: '1', name: 'Product 1' } } };
        const result = transformRelationFields(createFieldsWithSingleRelation(), entity);

        expect(result.customFields).toEqual({ featuredProductId: '1' });
        expect(result.customFields).not.toHaveProperty('featuredProduct');
    });

    it('should not mutate the original entity', () => {
        const entity = { customFields: { featuredProducts: [{ id: '1' }] } };
        const result = transformRelationFields(createFieldsWithListRelation(), entity);

        expect(entity.customFields.featuredProducts).toEqual([{ id: '1' }]);
        expect(result).not.toBe(entity);
    });

    it('should preserve other custom fields while transforming relations', () => {
        const fields: FieldInfo[] = [
            {
                name: 'customFields',
                type: 'CustomFields',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: false,
                typeInfo: [
                    {
                        name: 'featuredProductsIds',
                        type: 'ID',
                        nullable: true,
                        list: true,
                        isPaginatedList: false,
                        isScalar: true,
                    },
                    {
                        name: 'notes',
                        type: 'String',
                        nullable: true,
                        list: false,
                        isPaginatedList: false,
                        isScalar: true,
                    },
                ],
            },
        ];
        const entity = { customFields: { featuredProducts: [{ id: '1' }], notes: 'Some notes' } };
        const result = transformRelationFields(fields, entity);

        expect(result.customFields).toEqual({ featuredProductsIds: ['1'], notes: 'Some notes' });
    });

    it('should handle customFields nested inside input (draft order case)', () => {
        const fields: FieldInfo[] = [
            {
                name: 'orderId',
                type: 'ID',
                nullable: false,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
            {
                name: 'input',
                type: 'UpdateOrderInput',
                nullable: false,
                list: false,
                isPaginatedList: false,
                isScalar: false,
                typeInfo: [
                    {
                        name: 'id',
                        type: 'ID',
                        nullable: false,
                        list: false,
                        isPaginatedList: false,
                        isScalar: true,
                    },
                    {
                        name: 'customFields',
                        type: 'CustomFields',
                        nullable: true,
                        list: false,
                        isPaginatedList: false,
                        isScalar: false,
                        typeInfo: [
                            {
                                name: 'featuredProductId',
                                type: 'ID',
                                nullable: true,
                                list: false,
                                isPaginatedList: false,
                                isScalar: true,
                            },
                        ],
                    },
                ],
            },
        ];
        const entity = {
            orderId: 'order-1',
            input: {
                id: 'order-1',
                customFields: {
                    featuredProduct: { id: '3', name: 'Product 3' },
                },
            },
        };
        const result = transformRelationFields(fields, entity);

        expect(result.input.customFields).toEqual({ featuredProductId: '3' });
        expect(result.input.customFields).not.toHaveProperty('featuredProduct');
        expect(result.orderId).toBe('order-1');
    });

    it('should handle nested list relation customFields inside input', () => {
        const fields: FieldInfo[] = [
            {
                name: 'input',
                type: 'UpdateOrderInput',
                nullable: false,
                list: false,
                isPaginatedList: false,
                isScalar: false,
                typeInfo: [
                    {
                        name: 'customFields',
                        type: 'CustomFields',
                        nullable: true,
                        list: false,
                        isPaginatedList: false,
                        isScalar: false,
                        typeInfo: [
                            {
                                name: 'featuredProductsIds',
                                type: 'ID',
                                nullable: true,
                                list: true,
                                isPaginatedList: false,
                                isScalar: true,
                            },
                        ],
                    },
                ],
            },
        ];
        const entity = {
            input: {
                customFields: {
                    featuredProducts: [
                        { id: '1', name: 'Product 1' },
                        { id: '2', name: 'Product 2' },
                    ],
                },
            },
        };
        const result = transformRelationFields(fields, entity);

        expect(result.input.customFields).toEqual({ featuredProductsIds: ['1', '2'] });
        expect(result.input.customFields).not.toHaveProperty('featuredProducts');
    });

    it('should not mutate the original entity when processing nested customFields', () => {
        const fields: FieldInfo[] = [
            {
                name: 'input',
                type: 'UpdateOrderInput',
                nullable: false,
                list: false,
                isPaginatedList: false,
                isScalar: false,
                typeInfo: [
                    {
                        name: 'customFields',
                        type: 'CustomFields',
                        nullable: true,
                        list: false,
                        isPaginatedList: false,
                        isScalar: false,
                        typeInfo: [
                            {
                                name: 'featuredProductId',
                                type: 'ID',
                                nullable: true,
                                list: false,
                                isPaginatedList: false,
                                isScalar: true,
                            },
                        ],
                    },
                ],
            },
        ];
        const entity = {
            input: {
                customFields: {
                    featuredProduct: { id: '1', name: 'Product 1' },
                },
            },
        };
        const result = transformRelationFields(fields, entity);

        expect(entity.input.customFields.featuredProduct).toEqual({ id: '1', name: 'Product 1' });
        expect(result).not.toBe(entity);
        expect(result.input).not.toBe(entity.input);
    });

    it('should handle array fields containing customFields (e.g. translations)', () => {
        const fields: FieldInfo[] = [
            {
                name: 'lines',
                type: 'OrderLineInput',
                nullable: false,
                list: true,
                isPaginatedList: false,
                isScalar: false,
                typeInfo: [
                    {
                        name: 'customFields',
                        type: 'CustomFields',
                        nullable: true,
                        list: false,
                        isPaginatedList: false,
                        isScalar: false,
                        typeInfo: [
                            {
                                name: 'featuredProductId',
                                type: 'ID',
                                nullable: true,
                                list: false,
                                isPaginatedList: false,
                                isScalar: true,
                            },
                        ],
                    },
                ],
            },
        ];
        const entity = {
            lines: [
                { customFields: { featuredProduct: { id: '1', name: 'Product 1' } } },
                { customFields: { featuredProduct: { id: '2', name: 'Product 2' } } },
            ],
        };
        const result = transformRelationFields(fields, entity);

        expect(result.lines[0].customFields).toEqual({ featuredProductId: '1' });
        expect(result.lines[0].customFields).not.toHaveProperty('featuredProduct');
        expect(result.lines[1].customFields).toEqual({ featuredProductId: '2' });
        expect(result.lines[1].customFields).not.toHaveProperty('featuredProduct');
    });

    it('should not mutate original array items when processing array fields', () => {
        const fields: FieldInfo[] = [
            {
                name: 'lines',
                type: 'OrderLineInput',
                nullable: false,
                list: true,
                isPaginatedList: false,
                isScalar: false,
                typeInfo: [
                    {
                        name: 'customFields',
                        type: 'CustomFields',
                        nullable: true,
                        list: false,
                        isPaginatedList: false,
                        isScalar: false,
                        typeInfo: [
                            {
                                name: 'featuredProductId',
                                type: 'ID',
                                nullable: true,
                                list: false,
                                isPaginatedList: false,
                                isScalar: true,
                            },
                        ],
                    },
                ],
            },
        ];
        const entity = {
            lines: [{ customFields: { featuredProduct: { id: '1', name: 'Product 1' } } }],
        };
        transformRelationFields(fields, entity);

        expect(entity.lines[0].customFields.featuredProduct).toEqual({ id: '1', name: 'Product 1' });
    });
});

describe('convertEmptyStringsToNull', () => {
    it('should not throw when called with null values', () => {
        const fields: FieldInfo[] = [
            {
                name: 'customFields',
                type: 'CustomFieldsInput',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: false,
            },
        ];
        expect(() => convertEmptyStringsToNull(null as any, fields)).not.toThrow();
        expect(convertEmptyStringsToNull(null as any, fields)).toBeNull();
    });

    it('should preserve empty object for nullable non-scalar fields', () => {
        const fields: FieldInfo[] = [
            {
                name: 'customFields',
                type: 'CustomFieldsInput',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: false,
            },
        ];
        const values = { customFields: {} };
        const result = convertEmptyStringsToNull(values, fields);
        expect(result.customFields).toEqual({});
    });

    it('should convert empty string to null for nullable DateTime fields', () => {
        const fields: FieldInfo[] = [
            {
                name: 'releaseDate',
                type: 'DateTime',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
        ];
        const values = { releaseDate: '' };
        const result = convertEmptyStringsToNull(values, fields);
        expect(result.releaseDate).toBeNull();
    });

    it('should NOT convert empty string to null for nullable String fields', () => {
        const fields: FieldInfo[] = [
            {
                name: 'description',
                type: 'String',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
        ];
        const values = { description: '' };
        const result = convertEmptyStringsToNull(values, fields);
        expect(result.description).toBe('');
    });

    it('should convert empty strings to null in nested array objects', () => {
        const fields: FieldInfo[] = [
            {
                name: 'translations',
                type: 'TranslationInput',
                nullable: false,
                list: true,
                isPaginatedList: false,
                isScalar: false,
                typeInfo: [
                    {
                        name: 'releaseDate',
                        type: 'DateTime',
                        nullable: true,
                        list: false,
                        isPaginatedList: false,
                        isScalar: true,
                    },
                    {
                        name: 'name',
                        type: 'String',
                        nullable: true,
                        list: false,
                        isPaginatedList: false,
                        isScalar: true,
                    },
                ],
            },
        ];
        const values = {
            translations: [{ releaseDate: '', name: '' }],
        };
        const result = convertEmptyStringsToNull(values, fields);
        expect(result.translations[0].releaseDate).toBeNull();
        expect(result.translations[0].name).toBe('');
    });

    it('should not mutate the original values', () => {
        const fields: FieldInfo[] = [
            {
                name: 'releaseDate',
                type: 'DateTime',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
        ];
        const values = { releaseDate: '' };
        convertEmptyStringsToNull(values, fields);
        expect(values.releaseDate).toBe('');
    });
});

describe('stripNullNullableFields', () => {
    it('should strip null from nullable scalar fields', () => {
        const fields: FieldInfo[] = [
            {
                name: 'outOfStockThreshold',
                type: 'Int',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
            {
                name: 'weight',
                type: 'Float',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
            {
                name: 'releaseDate',
                type: 'DateTime',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
        ];
        const values = { outOfStockThreshold: null, weight: null, releaseDate: null };
        const result = stripNullNullableFields(values, fields);
        expect(result).toEqual({});
    });

    it('should preserve non-null values for nullable fields', () => {
        const fields: FieldInfo[] = [
            {
                name: 'outOfStockThreshold',
                type: 'Int',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
            {
                name: 'weight',
                type: 'Float',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
        ];
        const values = { outOfStockThreshold: 5, weight: null };
        const result = stripNullNullableFields(values, fields);
        expect(result).toEqual({ outOfStockThreshold: 5 });
    });

    it('should preserve null for non-nullable fields', () => {
        const fields: FieldInfo[] = [
            {
                name: 'code',
                type: 'String',
                nullable: false,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
        ];
        const values = { code: null };
        const result = stripNullNullableFields(values, fields);
        expect(result).toEqual({ code: null });
    });

    it('should handle nested objects with nullable fields', () => {
        const fields: FieldInfo[] = [
            {
                name: 'translations',
                type: 'TranslationInput',
                nullable: false,
                list: true,
                isPaginatedList: false,
                isScalar: false,
                typeInfo: [
                    {
                        name: 'name',
                        type: 'String',
                        nullable: false,
                        list: false,
                        isPaginatedList: false,
                        isScalar: true,
                    },
                    {
                        name: 'description',
                        type: 'String',
                        nullable: true,
                        list: false,
                        isPaginatedList: false,
                        isScalar: true,
                    },
                ],
            },
        ];
        const values = {
            translations: [{ name: 'Test', description: null }],
        };
        const result = stripNullNullableFields(values, fields);
        expect(result).toEqual({ translations: [{ name: 'Test' }] });
    });

    it('should handle null input gracefully', () => {
        const fields: FieldInfo[] = [];
        expect(stripNullNullableFields(null as any, fields)).toBeNull();
    });

    it('should not mutate the original values', () => {
        const fields: FieldInfo[] = [
            {
                name: 'threshold',
                type: 'Int',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
        ];
        const values = { threshold: null };
        const result = stripNullNullableFields(values, fields);
        expect(values.threshold).toBeNull();
        expect(result).toEqual({});
    });
});

describe('isFieldNullable', () => {
    it('should return true for nullable custom fields', () => {
        expect(
            isFieldNullable({
                name: 'featureType',
                type: 'string',
                nullable: true,
                readonly: false,
                list: false,
            } as ConfigurableFieldDef),
        ).toBe(true);
    });

    it('should return false for non-nullable custom fields', () => {
        expect(
            isFieldNullable({
                name: 'priority',
                type: 'string',
                nullable: false,
                readonly: false,
                list: false,
            } as ConfigurableFieldDef),
        ).toBe(false);
    });

    it('should return true for nullable struct sub-fields', () => {
        expect(
            isFieldNullable({
                name: 'kind',
                type: 'string',
                nullable: true,
                options: [{ value: 'a' }],
            } as ConfigurableFieldDef),
        ).toBe(true);
    });

    it('should return false for configurable operation args', () => {
        expect(
            isFieldNullable({
                name: 'arg',
                type: 'string',
                list: false,
                ui: { options: [{ value: 'a' }] },
            } as ConfigurableFieldDef),
        ).toBe(false);
    });
});
