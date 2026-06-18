import { printSchema } from 'graphql';
import { describe, expect, it } from 'vitest';

import { CustomFieldConfig, CustomFields } from '../../config/custom-field/custom-field-types';

import {
    addActiveAdministratorCustomFields,
    addGraphQLCustomFields,
    addOrderLineCustomFieldsInput,
    addRegisterCustomerCustomFieldsInput,
} from './graphql-custom-fields';

describe('addGraphQLCustomFields()', () => {
    it('uses JSON scalar if no custom fields defined', () => {
        const input = `
            type Product {
                id: ID
            }
        `;
        const customFieldConfig: CustomFields = {
            Product: [],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });

    // regression test for
    // https://github.com/vendurehq/vendure/issues/3158
    it('uses JSON scalar in UpdateActiveAdministratorInput if only internal custom fields defined on Administrator', () => {
        // custom field that is internal but not readonly - should not cause
        // `addActiveAdministratorCustomFields` to assume that
        // `UpdateAdministratorCustomFieldsInput` exists
        const customFieldConfig: Required<Pick<CustomFields, 'Administrator'>> = {
            Administrator: [{ name: 'testField', type: 'string', internal: true }],
        };
        // `addActiveAdministratorCustomFields` should add customFields to
        // UpdateActiveAdministratorInput as a JSON scalar. need to provide
        // those types for that to work
        const input = `
            scalar JSON

            input UpdateActiveAdministratorInput {
                placeholder: String
            }
        `;
        const schema = addActiveAdministratorCustomFields(input, customFieldConfig.Administrator);
        expect(printSchema(schema)).toMatchSnapshot();
    });

    it('extends a type', () => {
        const input = `
            type Product {
                id: ID
            }
        `;
        const customFieldConfig: CustomFields = {
            Product: [{ name: 'available', type: 'boolean' }],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('extends a type with a translation', () => {
        const input = `
                    type Product {
                        id: ID
                        translations: [ProductTranslation!]!
                    }

                    type ProductTranslation {
                        id: ID
                    }
                `;
        const customFieldConfig: CustomFields = {
            Product: [
                { name: 'available', type: 'boolean' },
                { name: 'shortName', type: 'localeString' },
            ],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('extends a type with a Create input', () => {
        const input = `
                    type Product {
                        id: ID
                    }

                    input CreateProductInput {
                        image: String
                    }
                `;
        const customFieldConfig: CustomFields = {
            Product: [
                { name: 'available', type: 'boolean' },
                { name: 'shortName', type: 'localeString' },
            ],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('extends a type with an Update input', () => {
        const input = `
                    type Product {
                        id: ID
                    }

                    input UpdateProductInput {
                        image: String
                    }
                `;
        const customFieldConfig: CustomFields = {
            Product: [
                { name: 'available', type: 'boolean' },
                { name: 'shortName', type: 'localeString' },
            ],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('extends a type with a Create input and a translation', () => {
        const input = `
                    type Product {
                        id: ID
                    }

                    type ProductTranslation {
                        id: ID
                    }

                    input ProductTranslationInput {
                        id: ID
                    }

                    input CreateProductInput {
                        image: String
                    }
                `;
        const customFieldConfig: CustomFields = {
            Product: [
                { name: 'available', type: 'boolean' },
                { name: 'shortName', type: 'localeString' },
            ],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('extends a type with SortParameters', () => {
        const input = `
                    type Product {
                        id: ID
                    }

                    input ProductSortParameter {
                        id: SortOrder
                    }

                    enum SortOrder {
                        ASC
                        DESC
                    }
                `;
        const customFieldConfig: CustomFields = {
            Product: [
                { name: 'available', type: 'boolean' },
                { name: 'shortName', type: 'localeString' },
            ],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('extends a type with FilterParameters', () => {
        const input = `
                    type Product {
                        name: String
                    }

                    input ProductFilterParameter {
                        id: StringOperators
                    }

                    input StringOperators {
                        eq: String
                    }

                    input NumberOperators {
                        eq: Float
                    }

                    input DateOperators {
                        eq: String
                    }

                    input BooleanOperators {
                        eq: Boolean
                    }

                `;
        const customFieldConfig: CustomFields = {
            Product: [
                { name: 'available', type: 'boolean' },
                { name: 'shortName', type: 'localeString' },
                { name: 'rating', type: 'float' },
                { name: 'published', type: 'datetime' },
            ],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('publicOnly = true', () => {
        const input = `
                 type Product {
                     id: ID
                 }
            `;
        const customFieldConfig: CustomFields = {
            Product: [
                { name: 'available', type: 'boolean', public: true },
                { name: 'profitMargin', type: 'float', public: false },
            ],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, true);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('extends OrderAddress if Address custom fields defined', () => {
        const input = `
             type Address {
                 id: ID
                 streetLine1: String
             }

             type OrderAddress {
                 streetLine1: String
             }
        `;
        const customFieldConfig: CustomFields = {
            Address: [{ name: 'instructions', type: 'string' }],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, true);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('handles deprecated custom fields', () => {
        const input = `
            type Product {
                id: ID
            }
        `;
        const customFieldConfig: CustomFields = {
            Product: [
                { name: 'available', type: 'boolean' },
                { name: 'oldField', type: 'string', deprecated: true },
                { name: 'legacyField', type: 'int', deprecated: 'Use newField instead' },
            ],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });

    it('handles deprecated custom fields with translations', () => {
        const input = `
            type Product {
                id: ID
                translations: [ProductTranslation!]!
            }

            type ProductTranslation {
                id: ID
            }
        `;
        const customFieldConfig: CustomFields = {
            Product: [
                { name: 'available', type: 'boolean' },
                { name: 'oldName', type: 'localeString', deprecated: 'Use name instead' },
            ],
        };
        const result = addGraphQLCustomFields(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });
});

describe('addOrderLineCustomFieldsInput()', () => {
    it('Modifies the schema when the addItemToOrder & adjustOrderLine mutation is present', () => {
        const input = `
            type Mutation {
                addItemToOrder(id: ID!, quantity: Int!): Boolean
                adjustOrderLine(id: ID!, quantity: Int): Boolean
            }
        `;
        const customFieldConfig: CustomFieldConfig[] = [
            { name: 'giftWrap', type: 'boolean' },
            { name: 'message', type: 'string' },
        ];
        const result = addOrderLineCustomFieldsInput(input, customFieldConfig, false);
        expect(printSchema(result)).toMatchSnapshot();
    });
});

describe('addRegisterCustomerCustomFieldsInput()', () => {
    it('add public writable custom fields to RegisterCustomerInput', () => {
        const input = `
            input RegisterCustomerInput {
                emailAddress: String!
                title: String
                firstName: String
                lastName: String
                phoneNumber: String
                password: String
            }

            type Mutation {
                registerCustomerAccount(input: RegisterCustomerInput!): Boolean!
            }
        `;
        const customFieldConfig: CustomFieldConfig[] = [
            { name: 'isB2B', type: 'boolean', nullable: false },
            { name: 'message', type: 'string' },
            { name: 'rating', type: 'int', public: false },
            { name: 'dbRef', type: 'int', internal: true },
        ];
        const result = addRegisterCustomerCustomFieldsInput(input, customFieldConfig);
        expect(printSchema(result)).toMatchSnapshot();
    });
});
