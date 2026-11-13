// this file relies on definitions that are only available at runtime, therefore we use gql here.
import { Asset, mergeConfig, Promotion, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

/**
 * `nullable` on a single relation custom field. Before v4 it was ignored: the column was always
 * nullable, and `nullable: false` failed config validation unless a `defaultValue` was set.
 * https://github.com/vendurehq/vendure/pull/4895
 */
describe('Relation custom field nullable', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                Promotion: [
                    { name: 'banner', type: 'relation', entity: Asset, nullable: false },
                    { name: 'thumbnail', type: 'relation', entity: Asset },
                ],
            },
        }),
    );

    const createPromotion = (customFields?: Record<string, any>) =>
        adminClient.query(
            gql`
                mutation ($input: CreatePromotionInput!) {
                    createPromotion(input: $input) {
                        ... on Promotion {
                            id
                            customFields {
                                banner {
                                    id
                                }
                            }
                        }
                    }
                }
            `,
            {
                input: {
                    enabled: true,
                    couponCode: `CODE-${Math.random()}`,
                    conditions: [],
                    actions: [
                        {
                            code: 'order_percentage_discount',
                            arguments: [{ name: 'discount', value: '10' }],
                        },
                    ],
                    translations: [{ languageCode: 'en', name: 'promo' }],
                    customFields,
                },
            },
        );

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

    it('nullable: false makes the column NOT NULL', () => {
        const metadata = server.app.get(TransactionalConnection).rawConnection.getMetadata(Promotion);
        const column = (propertyPath: string) => metadata.columns.find(c => c.propertyPath === propertyPath);
        expect(column('customFields.bannerId')?.isNullable).toBe(false);
        expect(column('customFields.thumbnailId')?.isNullable).toBe(true);
    });

    it('a create input must give a non-nullable relation', async () => {
        await expect(createPromotion()).rejects.toThrow(/"banner" value cannot be set to null/);
        await expect(createPromotion({ bannerId: null })).rejects.toThrow(/"banner" value cannot be set to null/);
    });

    it('creates the entity when the relation is given', async () => {
        const { createPromotion: promotion } = await createPromotion({ bannerId: 'T_1' });
        expect(promotion.customFields.banner).toEqual({ id: 'T_1' });
    });

    it('an update cannot set it to null', async () => {
        await expect(
            adminClient.query(gql`
                mutation {
                    updatePromotion(input: { id: "T_1", customFields: { bannerId: null } }) {
                        ... on Promotion {
                            id
                        }
                    }
                }
            `),
        ).rejects.toThrow(/"banner" value cannot be set to null/);
    });

    it('the database rejects a row without it', async () => {
        const repo = server.app.get(TransactionalConnection).rawConnection.getRepository(Promotion);
        await expect(
            repo.insert({
                enabled: true,
                priorityScore: 0,
                conditions: [],
                actions: [],
                customFields: {},
            } as any),
        ).rejects.toThrow(/NOT NULL|null value/i);
    });
});
