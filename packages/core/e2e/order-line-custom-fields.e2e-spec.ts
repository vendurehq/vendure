import { Permission } from '@vendure/common/lib/generated-types';
import { mergeConfig, OrderLine, Product, TransactionalConnection } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { FragmentOf as AdminFragmentOf, graphql as adminGraphql } from './graphql/graphql-admin';
import { FragmentOf, graphql } from './graphql/graphql-shop';
import { createAdministratorDocument, createRoleDocument } from './graphql/shared-definitions';
import { fixPostgresTimezone } from './utils/fix-pg-timezone';

const orderWithCustomFieldsFragment = graphql(`
    fragment OrderWithCustomFields on Order {
        id
        lines {
            id
            quantity
            customFields {
                stringField
                intField
                booleanField
                nullableField
                defaultedField
                relationField {
                    id
                    name
                }
            }
        }
    }
`);

const addItemToOrderWithCustomFieldsDocument = graphql(
    `
        mutation AddItemToOrderWithCustomFields(
            $productVariantId: ID!
            $quantity: Int!
            $customFields: OrderLineCustomFieldsInput
        ) {
            addItemToOrder(
                productVariantId: $productVariantId
                quantity: $quantity
                customFields: $customFields
            ) {
                ...OrderWithCustomFields
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithCustomFieldsFragment],
);

const adjustOrderLineWithCustomFieldsDocument = graphql(
    `
        mutation AdjustOrderLineWithCustomFields(
            $orderLineId: ID!
            $quantity: Int!
            $customFields: OrderLineCustomFieldsInput
        ) {
            adjustOrderLine(orderLineId: $orderLineId, quantity: $quantity, customFields: $customFields) {
                ...OrderWithCustomFields
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithCustomFieldsFragment],
);

const removeAllOrderLinesDocument = graphql(`
    mutation RemoveAllOrderLines {
        removeAllOrderLines {
            ... on Order {
                id
                lines {
                    id
                    quantity
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const addItemToOrderInlineFragmentDocument = graphql(
    `
        mutation AddItemToOrderInlineFragment(
            $productVariantId: ID!
            $customFields: OrderLineCustomFieldsInput
        ) {
            ... on Mutation {
                addItemToOrder(
                    productVariantId: $productVariantId
                    quantity: 1
                    customFields: $customFields
                ) {
                    ...OrderWithCustomFields
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        }
    `,
    [orderWithCustomFieldsFragment],
);

const adjustOrderLineThenAddItemToOrderDocument = graphql(
    `
        mutation AdjustOrderLineThenAddItemToOrder(
            $orderLineId: ID!
            $adjustCustomFields: OrderLineCustomFieldsInput
            $productVariantId: ID!
            $addCustomFields: OrderLineCustomFieldsInput
        ) {
            adjustOrderLine(orderLineId: $orderLineId, quantity: 2, customFields: $adjustCustomFields) {
                ...OrderWithCustomFields
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
            addItemToOrder(productVariantId: $productVariantId, quantity: 1, customFields: $addCustomFields) {
                ...OrderWithCustomFields
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithCustomFieldsFragment],
);

const addItemToOrderThenAdjustOrderLineDocument = graphql(
    `
        mutation AddItemToOrderThenAdjustOrderLine(
            $orderLineId: ID!
            $adjustCustomFields: OrderLineCustomFieldsInput
            $productVariantId: ID!
            $addCustomFields: OrderLineCustomFieldsInput
        ) {
            addItemToOrder(productVariantId: $productVariantId, quantity: 1, customFields: $addCustomFields) {
                ...OrderWithCustomFields
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
            adjustOrderLine(orderLineId: $orderLineId, quantity: 2, customFields: $adjustCustomFields) {
                ...OrderWithCustomFields
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithCustomFieldsFragment],
);

const getActiveOrderWithCustomFieldsDocument = graphql(
    `
        query GetActiveOrderWithCustomFields {
            activeOrder {
                ...OrderWithCustomFields
            }
        }
    `,
    [orderWithCustomFieldsFragment],
);

const addItemsToOrderWithCustomFieldsDocument = graphql(
    `
        mutation AddItemsToOrderWithCustomFields($inputs: [AddItemInput!]!) {
            addItemsToOrder(inputs: $inputs) {
                order {
                    ...OrderWithCustomFields
                }
                errorResults {
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        }
    `,
    [orderWithCustomFieldsFragment],
);

const draftOrderWithCustomFieldsFragment = adminGraphql(`
    fragment DraftOrderWithCustomFields on Order {
        id
        lines {
            id
            customFields {
                defaultedField
                validatedField
                readonlyField
                superAdminField
                readonlyStruct {
                    longFieldName
                    b
                }
            }
        }
    }
`);

const getDraftOrderWithCustomFieldsDocument = adminGraphql(
    `
        query GetDraftOrderWithCustomFields($id: ID!) {
            order(id: $id) {
                ...DraftOrderWithCustomFields
            }
        }
    `,
    [draftOrderWithCustomFieldsFragment],
);

const createDraftOrderDocument = adminGraphql(`
    mutation CreateDraftOrderForCustomFields {
        createDraftOrder {
            id
        }
    }
`);

const addItemToDraftOrderWithCustomFieldsDocument = adminGraphql(
    `
        mutation AddItemToDraftOrderWithCustomFields($orderId: ID!, $input: AddItemToDraftOrderInput!) {
            addItemToDraftOrder(orderId: $orderId, input: $input) {
                ...DraftOrderWithCustomFields
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [draftOrderWithCustomFieldsFragment],
);

const adjustDraftOrderLineWithCustomFieldsDocument = adminGraphql(
    `
        mutation AdjustDraftOrderLineWithCustomFields($orderId: ID!, $input: AdjustDraftOrderLineInput!) {
            adjustDraftOrderLine(orderId: $orderId, input: $input) {
                ...DraftOrderWithCustomFields
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [draftOrderWithCustomFieldsFragment],
);

type OrderWithCustomFields = FragmentOf<typeof orderWithCustomFieldsFragment>;
const orderGuard: ErrorResultGuard<OrderWithCustomFields> = createErrorResultGuard(input => !!input.lines);
type DraftOrderWithCustomFields = AdminFragmentOf<typeof draftOrderWithCustomFieldsFragment>;
const draftOrderGuard: ErrorResultGuard<DraftOrderWithCustomFields> = createErrorResultGuard(
    input => !!input.lines,
);

fixPostgresTimezone();

const customConfig = mergeConfig(testConfig(), {
    customFields: {
        OrderLine: [
            { name: 'stringField', type: 'string' },
            { name: 'intField', type: 'int' },
            { name: 'booleanField', type: 'boolean' },
            { name: 'nullableField', type: 'string', nullable: true },
            { name: 'relationField', type: 'relation', entity: Product },
            // The database column default fills this field for any OrderLine inserted without a value.
            { name: 'defaultedField', type: 'string', nullable: true, defaultValue: 'default value' },
            { name: 'validatedField', type: 'string', nullable: true, pattern: '^[a-z]+$' },
            // The API cannot set a readonly field, so the database column default sets this one.
            { name: 'readonlyField', type: 'string', readonly: true, defaultValue: 'readonly value' },
            {
                name: 'readonlyStruct',
                type: 'struct',
                readonly: true,
                fields: [
                    { name: 'longFieldName', type: 'string' },
                    { name: 'b', type: 'string' },
                ],
            },
            {
                name: 'superAdminField',
                type: 'string',
                nullable: true,
                requiresPermission: Permission.SuperAdmin,
            },
        ],
    },
});

describe('OrderLine Custom Fields', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(customConfig);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    beforeEach(async () => {
        // Clear the shopping cart before each test to ensure test isolation
        await shopClient.query(removeAllOrderLinesDocument);
    });

    describe('addItemToOrder', () => {
        it('can add order line with custom fields', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_1',
                quantity: 1,
                customFields: { stringField: 'test value', intField: 42, booleanField: true },
            });
            orderGuard.assertSuccess(addItemToOrder);

            expect(addItemToOrder.lines[0].customFields).toEqual({
                stringField: 'test value',
                intField: 42,
                booleanField: true,
                nullableField: null,
                defaultedField: 'default value',
                relationField: null,
            });
        });

        it('can add order line with relation custom field', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_2',
                quantity: 1,
                customFields: { relationFieldId: 'T_1' },
            });
            orderGuard.assertSuccess(addItemToOrder);

            expect(addItemToOrder.lines[0].customFields.relationField.id).toBe('T_1');
        });
    });

    describe('adjustOrderLine - merging behavior', () => {
        it('should merge custom fields when updating partial fields', async () => {
            // Create a fresh order line for this test
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_3',
                quantity: 1,
                customFields: {
                    stringField: 'initial value',
                    intField: 100,
                    booleanField: false,
                    nullableField: 'not null',
                },
            });
            orderGuard.assertSuccess(addItemToOrder);
            const orderLineId = addItemToOrder.lines[0].id;

            const { adjustOrderLine } = await shopClient.query(adjustOrderLineWithCustomFieldsDocument, {
                orderLineId,
                quantity: 2,
                customFields: {
                    stringField: 'updated value',
                },
            });
            orderGuard.assertSuccess(adjustOrderLine);

            const updatedLine = adjustOrderLine.lines.find(line => line.id === orderLineId);
            expect(updatedLine.customFields).toEqual({
                stringField: 'updated value', // updated
                intField: 100, // preserved
                booleanField: false, // preserved
                nullableField: 'not null', // preserved
                defaultedField: 'default value',
                relationField: null, // preserved
            });
        });

        it('should allow updating multiple fields while preserving others', async () => {
            // Create a fresh order line for this test
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_4',
                quantity: 1,
                customFields: {
                    stringField: 'initial value',
                    intField: 100,
                    booleanField: false,
                    nullableField: 'not null',
                },
            });
            orderGuard.assertSuccess(addItemToOrder);
            const orderLineId = addItemToOrder.lines[0].id;

            const { adjustOrderLine } = await shopClient.query(adjustOrderLineWithCustomFieldsDocument, {
                orderLineId,
                quantity: 2,
                customFields: {
                    intField: 200,
                    booleanField: true,
                },
            });
            orderGuard.assertSuccess(adjustOrderLine);

            const updatedLine = adjustOrderLine.lines.find(line => line.id === orderLineId);
            expect(updatedLine.customFields).toEqual({
                stringField: 'initial value', // preserved
                intField: 200, // updated
                booleanField: true, // updated
                nullableField: 'not null', // preserved
                defaultedField: 'default value',
                relationField: null, // preserved
            });
        });

        it('should allow unsetting fields using null', async () => {
            // Create a fresh order line for this test
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_1',
                quantity: 1,
                customFields: {
                    stringField: 'initial value',
                    intField: 100,
                    booleanField: false,
                    nullableField: 'not null',
                },
            });
            orderGuard.assertSuccess(addItemToOrder);
            const orderLineId = addItemToOrder.lines[0].id;

            const { adjustOrderLine } = await shopClient.query(adjustOrderLineWithCustomFieldsDocument, {
                orderLineId,
                quantity: 2,
                customFields: {
                    nullableField: null,
                },
            });
            orderGuard.assertSuccess(adjustOrderLine);

            const updatedLine = adjustOrderLine.lines.find(line => line.id === orderLineId);
            expect(updatedLine.customFields).toEqual({
                stringField: 'initial value', // preserved
                intField: 100, // preserved
                booleanField: false, // preserved
                nullableField: null, // unset using null
                defaultedField: 'default value',
                relationField: null, // preserved
            });
        });

        it('should handle relation field updates with merging', async () => {
            // Create a fresh order line for this test
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_2',
                quantity: 1,
                customFields: {
                    stringField: 'initial value',
                    intField: 100,
                    booleanField: false,
                    nullableField: 'not null',
                },
            });
            orderGuard.assertSuccess(addItemToOrder);
            const orderLineId = addItemToOrder.lines[0].id;

            const { adjustOrderLine } = await shopClient.query(adjustOrderLineWithCustomFieldsDocument, {
                orderLineId,
                quantity: 2,
                customFields: {
                    relationFieldId: 'T_1',
                },
            });
            orderGuard.assertSuccess(adjustOrderLine);

            const updatedLine = adjustOrderLine.lines.find(line => line.id === orderLineId);
            expect(updatedLine.customFields).toEqual({
                stringField: 'initial value', // preserved
                intField: 100, // preserved
                booleanField: false, // preserved
                nullableField: 'not null', // preserved
                defaultedField: 'default value',
                relationField: {
                    id: 'T_1',
                    name: 'Laptop',
                },
            });
        });

        it('should allow unsetting relation field using null', async () => {
            // Create a fresh order line for this test
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_3',
                quantity: 1,
                customFields: {
                    stringField: 'initial value',
                    intField: 100,
                    booleanField: false,
                    nullableField: 'not null',
                    relationFieldId: 'T_1',
                },
            });
            orderGuard.assertSuccess(addItemToOrder);
            const orderLineId = addItemToOrder.lines[0].id;

            const { adjustOrderLine } = await shopClient.query(adjustOrderLineWithCustomFieldsDocument, {
                orderLineId,
                quantity: 2,
                customFields: {
                    relationFieldId: null,
                },
            });
            orderGuard.assertSuccess(adjustOrderLine);

            const updatedLine = adjustOrderLine.lines.find(line => line.id === orderLineId);
            expect(updatedLine.customFields).toEqual({
                stringField: 'initial value', // preserved
                intField: 100, // preserved
                booleanField: false, // preserved
                nullableField: 'not null', // preserved
                defaultedField: 'default value',
                relationField: null, // unset using null
            });
        });
    });

    // CustomFieldProcessingInterceptor decides whether OrderLine defaults apply from the mutation field
    // being resolved. An addItemToOrder selected through a fragment gets the defaults, and a sibling
    // adjustOrderLine in the same document does not change whether they apply.
    describe('default values in fragment-wrapped and multi-field mutations', () => {
        async function getStoredLines() {
            const { activeOrder } = await shopClient.query(getActiveOrderWithCustomFieldsDocument);
            return activeOrder?.lines ?? [];
        }

        async function addLineWithExplicitValue(productVariantId: string): Promise<string> {
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId,
                quantity: 1,
                customFields: { defaultedField: 'explicit value' },
            });
            orderGuard.assertSuccess(addItemToOrder);
            return addItemToOrder.lines[0].id;
        }

        // A named fragment is not covered here: IdInterceptor does not decode the productVariantId
        // argument inside a named fragment definition (#5511).
        it('applies the default to an addItemToOrder selected through an inline fragment', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderInlineFragmentDocument, {
                productVariantId: 'T_1',
                customFields: { defaultedField: null },
            });
            orderGuard.assertSuccess(addItemToOrder);

            const [line] = await getStoredLines();
            expect(line.customFields.defaultedField).toBe('default value');
        });

        it('applies the default to an addItemToOrder placed after a sibling adjustOrderLine', async () => {
            const adjustedLineId = await addLineWithExplicitValue('T_1');
            const { adjustOrderLine, addItemToOrder } = await shopClient.query(
                adjustOrderLineThenAddItemToOrderDocument,
                {
                    orderLineId: adjustedLineId,
                    adjustCustomFields: {},
                    productVariantId: 'T_2',
                    addCustomFields: { defaultedField: null },
                },
            );
            orderGuard.assertSuccess(adjustOrderLine);
            orderGuard.assertSuccess(addItemToOrder);

            const addedLine = (await getStoredLines()).find(line => line.id !== adjustedLineId);
            expect(addedLine?.customFields.defaultedField).toBe('default value');
        });

        it('does not apply the default to an adjustOrderLine placed after a sibling addItemToOrder', async () => {
            const adjustedLineId = await addLineWithExplicitValue('T_1');
            const { addItemToOrder, adjustOrderLine } = await shopClient.query(
                addItemToOrderThenAdjustOrderLineDocument,
                {
                    orderLineId: adjustedLineId,
                    adjustCustomFields: { defaultedField: null },
                    productVariantId: 'T_2',
                    addCustomFields: {},
                },
            );
            orderGuard.assertSuccess(addItemToOrder);
            orderGuard.assertSuccess(adjustOrderLine);

            const adjustedLine = (await getStoredLines()).find(line => line.id === adjustedLineId);
            expect(adjustedLine?.customFields.defaultedField).toBeNull();
        });
    });

    // #5513 — addItemsToOrder, addItemToDraftOrder and adjustDraftOrderLine nest OrderLineCustomFieldsInput
    // in AddItemInput, AddItemToDraftOrderInput and AdjustDraftOrderLineInput
    describe('mutations which nest OrderLineCustomFieldsInput in another input type', () => {
        const invalidValue = 'Not Valid';
        const patternError = 'does not match the pattern';

        describe('addItemsToOrder', () => {
            it('applies the default to a field set to null', async () => {
                const { addItemsToOrder } = await shopClient.query(addItemsToOrderWithCustomFieldsDocument, {
                    inputs: [
                        { productVariantId: 'T_1', quantity: 1, customFields: { defaultedField: null } },
                    ],
                });
                expect(addItemsToOrder.errorResults).toEqual([]);

                expect(addItemsToOrder.order.lines[0].customFields.defaultedField).toBe('default value');
            });

            it('validates the custom field values', async () => {
                await expect(
                    shopClient.query(addItemsToOrderWithCustomFieldsDocument, {
                        inputs: [
                            {
                                productVariantId: 'T_1',
                                quantity: 1,
                                customFields: { validatedField: 'valid' },
                            },
                            {
                                productVariantId: 'T_2',
                                quantity: 1,
                                customFields: { validatedField: invalidValue },
                            },
                        ],
                    }),
                ).rejects.toThrow(patternError);
            });
        });

        describe('draft orders', () => {
            let draftOrderId: string;

            beforeAll(async () => {
                const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);
                draftOrderId = createDraftOrder.id;
            });

            async function addDraftOrderLine(productVariantId: string, customFields: Record<string, any>) {
                const { addItemToDraftOrder } = await adminClient.query(
                    addItemToDraftOrderWithCustomFieldsDocument,
                    { orderId: draftOrderId, input: { productVariantId, quantity: 1, customFields } },
                );
                draftOrderGuard.assertSuccess(addItemToDraftOrder);
                return addItemToDraftOrder;
            }

            describe('addItemToDraftOrder', () => {
                it('applies the default to a field set to null', async () => {
                    const order = await addDraftOrderLine('T_1', { defaultedField: null });

                    expect(order.lines[0].customFields.defaultedField).toBe('default value');
                });

                it('validates the custom field values', async () => {
                    await expect(addDraftOrderLine('T_2', { validatedField: invalidValue })).rejects.toThrow(
                        patternError,
                    );
                });
            });

            // adjustDraftOrderLine and adjustOrderLine both call OrderService.adjustOrderLine(), where null
            // unsets a field. Neither mutation applies defaults.
            describe('adjustDraftOrderLine', () => {
                let lineId: string;

                beforeAll(async () => {
                    const order = await addDraftOrderLine('T_3', { defaultedField: 'explicit value' });
                    const line = order.lines.find(l => l.customFields.defaultedField === 'explicit value');
                    if (!line) {
                        throw new Error('The draft order line was not added');
                    }
                    lineId = line.id;
                });

                it('does not apply the default to a field set to null', async () => {
                    const { adjustDraftOrderLine } = await adminClient.query(
                        adjustDraftOrderLineWithCustomFieldsDocument,
                        {
                            orderId: draftOrderId,
                            input: {
                                orderLineId: lineId,
                                quantity: 2,
                                customFields: { defaultedField: null },
                            },
                        },
                    );
                    draftOrderGuard.assertSuccess(adjustDraftOrderLine);

                    const line = adjustDraftOrderLine.lines.find(l => l.id === lineId);
                    expect(line?.customFields.defaultedField).toBeNull();
                });

                it('validates the custom field values', async () => {
                    await expect(
                        adminClient.query(adjustDraftOrderLineWithCustomFieldsDocument, {
                            orderId: draftOrderId,
                            input: {
                                orderLineId: lineId,
                                quantity: 2,
                                customFields: { validatedField: invalidValue },
                            },
                        }),
                    ).rejects.toThrow(patternError);
                });
            });

            // The Dashboard sends the line's whole customFields object back when it changes the quantity. The
            // object includes readonly fields. It also includes fields the administrator cannot read, and the
            // Admin API returns those fields as null.
            describe('adjustDraftOrderLine with the whole customFields object', () => {
                const limitedAdminEmail = 'order-line-limited-admin@test.com';
                let lineId: string;

                async function adjustLine(customFields: Record<string, any>) {
                    const { adjustDraftOrderLine } = await adminClient.query(
                        adjustDraftOrderLineWithCustomFieldsDocument,
                        { orderId: draftOrderId, input: { orderLineId: lineId, quantity: 1, customFields } },
                    );
                    draftOrderGuard.assertSuccess(adjustDraftOrderLine);
                    const line = adjustDraftOrderLine.lines.find(l => l.id === lineId);
                    if (!line) {
                        throw new Error('The draft order line was not found');
                    }
                    return line;
                }

                beforeAll(async () => {
                    const { createRole } = await adminClient.query(createRoleDocument, {
                        input: {
                            code: 'order-line-limited-admin',
                            description: 'Order line limited admin',
                            permissions: [
                                Permission.ReadOrder,
                                Permission.UpdateOrder,
                                Permission.CreateOrder,
                            ],
                        },
                    });
                    await adminClient.query(createAdministratorDocument, {
                        input: {
                            firstName: 'Limited',
                            lastName: 'Admin',
                            emailAddress: limitedAdminEmail,
                            roleIds: [createRole.id],
                            password: 'test',
                        },
                    });
                    const order = await addDraftOrderLine('T_4', { validatedField: 'whole' });
                    const line = order.lines.find(l => l.customFields.validatedField === 'whole');
                    if (!line) {
                        throw new Error('The draft order line was not added');
                    }
                    lineId = line.id;
                    await adjustLine({ superAdminField: 'stored value' });
                });

                afterAll(async () => {
                    await adminClient.asSuperAdmin();
                });

                it('accepts an unchanged readonly field', async () => {
                    const line = await adjustLine({
                        validatedField: 'whole',
                        readonlyField: 'readonly value',
                    });

                    expect(line.customFields.readonlyField).toBe('readonly value');
                });

                // Postgres and MySQL reorder the keys of a stored JSON object, so the stored key order can differ
                // from the order of the input type's fields.
                it('accepts an unchanged readonly struct field', async () => {
                    const struct = { longFieldName: 'long', b: 'short' };
                    await server.app
                        .get(TransactionalConnection)
                        .rawConnection.getRepository(OrderLine)
                        .update(lineId.replace('T_', ''), {
                            customFields: { readonlyStruct: struct },
                        } as any);

                    const line = await adjustLine({ readonlyStruct: struct });

                    expect(line.customFields.readonlyStruct).toEqual(struct);
                });

                it('rejects a changed readonly field', async () => {
                    await expect(adjustLine({ readonlyField: 'changed value' })).rejects.toThrow(
                        'The custom field "readonlyField" is readonly',
                    );
                });

                it('accepts null for a field the administrator cannot read, and keeps the stored value', async () => {
                    await adminClient.asUserWithCredentials(limitedAdminEmail, 'test');
                    const line = await adjustLine({
                        validatedField: 'whole',
                        readonlyField: 'readonly value',
                        superAdminField: null,
                    });
                    expect(line.customFields.superAdminField).toBeNull();

                    await adminClient.asSuperAdmin();
                    const stored = await adjustLine({});
                    expect(stored.customFields.superAdminField).toBe('stored value');
                });

                it('accepts null for a field the administrator cannot read when adding a line', async () => {
                    await adminClient.asUserWithCredentials(limitedAdminEmail, 'test');
                    const { addItemToDraftOrder } = await adminClient.query(
                        addItemToDraftOrderWithCustomFieldsDocument,
                        {
                            orderId: draftOrderId,
                            input: {
                                productVariantId: 'T_2',
                                quantity: 1,
                                customFields: { validatedField: 'unreadable', superAdminField: null },
                            },
                        },
                    );
                    draftOrderGuard.assertSuccess(addItemToDraftOrder);
                    const line = addItemToDraftOrder.lines.find(
                        l => l.customFields.validatedField === 'unreadable',
                    );

                    await adminClient.asSuperAdmin();
                    const { order } = await adminClient.query(getDraftOrderWithCustomFieldsDocument, {
                        id: draftOrderId,
                    });
                    const storedLine = order?.lines.find(l => l.id === line?.id);
                    expect(storedLine?.customFields.superAdminField).toBeNull();
                });

                it('rejects a value for a field the administrator cannot read', async () => {
                    await adminClient.asUserWithCredentials(limitedAdminEmail, 'test');
                    await expect(adjustLine({ superAdminField: 'changed value' })).rejects.toThrow(
                        'You do not have the required permissions to update the "superAdminField" field',
                    );
                });
            });
        });
    });

    describe('edge cases', () => {
        it('should handle empty custom fields object', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_4',
                quantity: 1,
                customFields: {},
            });
            orderGuard.assertSuccess(addItemToOrder);

            const newLine = addItemToOrder.lines[0];
            expect(newLine.customFields).toEqual({
                stringField: null,
                intField: null,
                booleanField: null,
                nullableField: null,
                defaultedField: 'default value',
                relationField: null,
            });
        });

        it('should handle adjustOrderLine with empty custom fields', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_1',
                quantity: 1,
                customFields: { stringField: 'will be preserved', intField: 999 },
            });
            orderGuard.assertSuccess(addItemToOrder);

            const lineId = addItemToOrder.lines[0].id;

            const { adjustOrderLine } = await shopClient.query(adjustOrderLineWithCustomFieldsDocument, {
                orderLineId: lineId,
                quantity: 2,
                customFields: {},
            });
            orderGuard.assertSuccess(adjustOrderLine);

            const updatedLine = adjustOrderLine.lines.find(line => line.id === lineId);
            expect(updatedLine.customFields).toEqual({
                stringField: 'will be preserved', // preserved when empty object passed
                intField: 999, // preserved when empty object passed
                booleanField: null, // default value for unset fields
                nullableField: null, // default value for unset fields
                defaultedField: 'default value',
                relationField: null, // default value for unset fields
            });
        });
    });
});
