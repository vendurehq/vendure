import {
    CurrencyCode,
    DeletionResult,
    ErrorCode,
    LanguageCode,
    Permission,
} from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { ConfigService, type PromotionAction, PromotionCondition, PromotionOrderAction } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    type ErrorResultGuard,
} from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { channelFragment, promotionFragment } from './graphql/fragments-admin';
import type { FragmentOf, ResultOf } from './graphql/graphql-admin';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    assignPromotionsToChannelDocument,
    createAdministratorDocument,
    createChannelDocument,
    createPromotionDocument,
    createRoleDocument,
    deletePromotionDocument,
    getAdjustmentOperationsDocument,
    getPromotionDocument,
    getPromotionListDocument,
    removePromotionsFromChannelDocument,
    updatePromotionDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

type PromotionFragment = FragmentOf<typeof promotionFragment>;
type PromotionListItem = ResultOf<typeof getPromotionListDocument>['promotions']['items'][number];

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('Promotion resolver', () => {
    const promoCondition = generateTestCondition('promo_condition');
    const promoCondition2 = generateTestCondition('promo_condition2');
    const promoAction = generateTestAction('promo_action');

    const { server, adminClient } = createTestEnvironment({
        ...testConfig(),
        promotionOptions: {
            promotionConditions: [promoCondition, promoCondition2],
            promotionActions: [promoAction],
        },
    });

    const snapshotProps: Array<keyof PromotionFragment> = [
        'name',
        'actions',
        'conditions',
        'enabled',
        'couponCode',
        'startsAt',
        'endsAt',
    ];

    let promotion: PromotionFragment;

    const promotionGuard: ErrorResultGuard<PromotionFragment> = createErrorResultGuard(
        input => !!input.couponCode,
    );

    const promotionQueryGuard: ErrorResultGuard<
        NonNullable<ResultOf<typeof getPromotionDocument>['promotion']>
    > = createErrorResultGuard(input => !!input.id);

    const channelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard(
        input => !!input.token,
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

    it('createPromotion', async () => {
        const { createPromotion } = await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                couponCode: 'TEST123',
                startsAt: new Date('2019-10-30T00:00:00.000Z').toISOString(),
                endsAt: new Date('2019-12-01T00:00:00.000Z').toISOString(),
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'test promotion',
                        description: 'a test promotion',
                    },
                ],
                conditions: [
                    {
                        code: promoCondition.code,
                        arguments: [{ name: 'arg', value: '500' }],
                    },
                ],
                actions: [
                    {
                        code: promoAction.code,
                        arguments: [
                            {
                                name: 'facetValueIds',
                                value: '["T_1"]',
                            },
                        ],
                    },
                ],
            },
        });
        promotionGuard.assertSuccess(createPromotion);

        promotion = createPromotion;
        expect(pick(promotion, snapshotProps)).toMatchSnapshot();
    });

    it('createPromotion with no description', async () => {
        const { createPromotion } = await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                couponCode: 'TEST567',
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'test promotion no description',
                        customFields: {},
                    },
                ],
                conditions: [],
                actions: [
                    {
                        code: promoAction.code,
                        arguments: [
                            {
                                name: 'facetValueIds',
                                value: '["T_1"]',
                            },
                        ],
                    },
                ],
            },
        });
        promotionGuard.assertSuccess(createPromotion);
        expect(createPromotion.name).toBe('test promotion no description');
        expect(createPromotion.description).toBe('');
        expect(createPromotion.translations[0].description).toBe('');
    });

    it('createPromotion return error result with empty conditions and no couponCode', async () => {
        const { createPromotion } = await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'bad promotion',
                    },
                ],
                conditions: [],
                actions: [
                    {
                        code: promoAction.code,
                        arguments: [
                            {
                                name: 'facetValueIds',
                                value: '["T_1"]',
                            },
                        ],
                    },
                ],
            },
        });
        promotionGuard.assertErrorResult(createPromotion);

        expect(createPromotion.message).toBe(
            'A Promotion must have either at least one condition or a coupon code set',
        );
        expect(createPromotion.errorCode).toBe(ErrorCode.MISSING_CONDITIONS_ERROR);
    });

    it('updatePromotion', async () => {
        const { updatePromotion } = await adminClient.query(updatePromotionDocument, {
            input: {
                id: promotion.id,
                couponCode: 'TEST1235',
                startsAt: new Date('2019-05-30T22:00:00.000Z').toISOString(),
                endsAt: new Date('2019-06-01T22:00:00.000Z').toISOString(),
                conditions: [
                    {
                        code: promoCondition.code,
                        arguments: [{ name: 'arg', value: '90' }],
                    },
                    {
                        code: promoCondition2.code,
                        arguments: [{ name: 'arg', value: '10' }],
                    },
                ],
            },
        });
        promotionGuard.assertSuccess(updatePromotion);

        expect(pick(updatePromotion, snapshotProps)).toMatchSnapshot();
    });

    // #4700 — updatePromotion should not double-decode ID args in actions
    it('updatePromotion with ID list args in actions', async () => {
        const configService = server.app.get(ConfigService);
        const decodeIdSpy = vi.spyOn(configService.entityIdStrategy, 'decodeId');

        const { updatePromotion } = await adminClient.query(updatePromotionDocument, {
            input: {
                id: promotion.id,
                actions: [
                    {
                        code: promoAction.code,
                        arguments: [{ name: 'facetValueIds', value: '["T_1"]' }],
                    },
                ],
            },
        });
        promotionGuard.assertSuccess(updatePromotion);

        // Verify the action args were correctly round-tripped (decoded and re-encoded)
        const action = updatePromotion.actions.find(a => a.code === promoAction.code);
        expect(action).toBeDefined();
        const facetValueIdsArg = action!.args.find(a => a.name === 'facetValueIds');
        expect(facetValueIdsArg).toBeDefined();
        expect(facetValueIdsArg!.value).toBe('["T_1"]');

        // Verify decodeId was never called with a raw numeric string,
        // which would indicate double-decoding of ID args
        for (const call of decodeIdSpy.mock.calls) {
            const id = call[0];
            if (typeof id === 'string') {
                expect(id).toMatch(/^T_/);
            }
        }

        decodeIdSpy.mockRestore();
    });

    it('updatePromotion return error result with empty conditions and no couponCode', async () => {
        const { updatePromotion } = await adminClient.query(updatePromotionDocument, {
            input: {
                id: promotion.id,
                couponCode: '',
                conditions: [],
            },
        });
        promotionGuard.assertErrorResult(updatePromotion);

        expect(updatePromotion.message).toBe(
            'A Promotion must have either at least one condition or a coupon code set',
        );
        expect(updatePromotion.errorCode).toBe(ErrorCode.MISSING_CONDITIONS_ERROR);
    });

    it('promotion', async () => {
        const result = await adminClient.query(getPromotionDocument, {
            id: promotion.id,
        });

        promotionQueryGuard.assertSuccess(result.promotion);

        expect(result.promotion.name).toBe(promotion.name);
    });

    it('promotions', async () => {
        const result = await adminClient.query(getPromotionListDocument, {});

        expect(result.promotions.totalItems).toBe(2);
        expect(result.promotions.items[0].name).toBe('test promotion');
    });

    it('adjustmentOperations', async () => {
        const result = await adminClient.query(getAdjustmentOperationsDocument);

        expect(result.promotionActions).toMatchSnapshot();
        expect(result.promotionConditions).toMatchSnapshot();
    });

    describe('channels', () => {
        const SECOND_CHANNEL_TOKEN = 'SECOND_CHANNEL_TOKEN';
        let secondChannel: FragmentOf<typeof channelFragment>;
        beforeAll(async () => {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'second-channel',
                    token: SECOND_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    pricesIncludeTax: true,
                    currencyCode: CurrencyCode.EUR,
                    defaultTaxZoneId: 'T_1',
                    defaultShippingZoneId: 'T_2',
                },
            });
            channelGuard.assertSuccess(createChannel);
            secondChannel = createChannel;
        });

        it('does not list Promotions not in active channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { promotions } = await adminClient.query(getPromotionListDocument);

            expect(promotions.totalItems).toBe(0);
            expect(promotions.items).toEqual([]);
        });

        it('does not return Promotion not in active channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { promotion: result } = await adminClient.query(getPromotionDocument, {
                id: promotion.id,
            });

            expect(result).toBeNull();
        });

        it('assignPromotionsToChannel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { assignPromotionsToChannel } = await adminClient.query(assignPromotionsToChannelDocument, {
                input: {
                    channelId: secondChannel.id,
                    promotionIds: [promotion.id],
                },
            });

            expect(assignPromotionsToChannel).toEqual([{ id: promotion.id, name: promotion.name }]);

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { promotion: result } = await adminClient.query(getPromotionDocument, {
                id: promotion.id,
            });
            expect(result?.id).toBe(promotion.id);

            const { promotions } = await adminClient.query(getPromotionListDocument);
            expect(promotions.totalItems).toBe(1);
            expect(promotions.items.map(pick(['id']))).toEqual([{ id: promotion.id }]);
        });

        it('removePromotionsFromChannel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { removePromotionsFromChannel } = await adminClient.query(
                removePromotionsFromChannelDocument,
                {
                    input: {
                        channelId: secondChannel.id,
                        promotionIds: [promotion.id],
                    },
                },
            );

            expect(removePromotionsFromChannel).toEqual([{ id: promotion.id, name: promotion.name }]);

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { promotion: result } = await adminClient.query(getPromotionDocument, {
                id: promotion.id,
            });
            expect(result).toBeNull();

            const { promotions } = await adminClient.query(getPromotionListDocument);
            expect(promotions.totalItems).toBe(0);
        });

        // #5093 — cannot remove a Promotion from the default channel
        it('cannot remove a Promotion from the default channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await expect(
                adminClient.query(removePromotionsFromChannelDocument, {
                    input: {
                        channelId: 'T_1',
                        promotionIds: [promotion.id],
                    },
                }),
            ).rejects.toThrow('Items cannot be removed from the default Channel');
        });

        it('cannot delete a Promotion belonging to another channel', async () => {
            // promotion belongs to default channel only (removed from second channel above)
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await expect(
                adminClient.query(deletePromotionDocument, {
                    id: promotion.id,
                }),
            ).rejects.toThrow(/No Promotion with the id .* could be found/);

            // Verify the Promotion still exists in the default channel
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { promotion: result } = await adminClient.query(getPromotionDocument, {
                id: promotion.id,
            });
            expect(result?.name).toBe('test promotion');
        });

        describe('cannot assign/remove without permission on the target channel', () => {
            const RESTRICTED_ADMIN_EMAIL = 'promotion-channel-permission-test@e2e.com';
            const RESTRICTED_ADMIN_PASSWORD = 'test';

            beforeAll(async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.asSuperAdmin();

                // Make the Promotion visible in secondChannel so the restricted admin can
                // reach it below, rather than being stopped by the visibility filter.
                await adminClient.query(assignPromotionsToChannelDocument, {
                    input: {
                        channelId: secondChannel.id,
                        promotionIds: [promotion.id],
                    },
                });

                const { createRole } = await adminClient.query(createRoleDocument, {
                    input: {
                        code: 'promotion-channel-permission-test-role',
                        description: '',
                        channelIds: [secondChannel.id],
                        permissions: [Permission.UpdatePromotion],
                    },
                });
                await adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'Restricted',
                        lastName: 'Admin',
                        emailAddress: RESTRICTED_ADMIN_EMAIL,
                        password: RESTRICTED_ADMIN_PASSWORD,
                        roleIds: [createRole.id],
                    },
                });
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.asUserWithCredentials(RESTRICTED_ADMIN_EMAIL, RESTRICTED_ADMIN_PASSWORD);
            });

            afterAll(async () => {
                await adminClient.asSuperAdmin();
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.query(removePromotionsFromChannelDocument, {
                    input: {
                        channelId: secondChannel.id,
                        promotionIds: [promotion.id],
                    },
                });
            });

            it('can assign a Promotion to a channel it has permission on', async () => {
                // Positive control for the rejections below.
                const { assignPromotionsToChannel } = await adminClient.query(assignPromotionsToChannelDocument, {
                    input: {
                        channelId: secondChannel.id,
                        promotionIds: [promotion.id],
                    },
                });
                expect(assignPromotionsToChannel).toEqual([{ id: promotion.id, name: promotion.name }]);
            });

            it('cannot assign a Promotion to a channel it has no permission on', async () => {
                // the restricted admin only has UpdatePromotion on secondChannel, not on the default channel
                await expect(
                    adminClient.query(assignPromotionsToChannelDocument, {
                        input: {
                            channelId: 'T_1',
                            promotionIds: [promotion.id],
                        },
                    }),
                ).rejects.toThrow(/not currently authorized/);
            });

            it('cannot remove a Promotion from a channel it has no permission on', async () => {
                await expect(
                    adminClient.query(removePromotionsFromChannelDocument, {
                        input: {
                            channelId: 'T_1',
                            promotionIds: [promotion.id],
                        },
                    }),
                ).rejects.toThrow(/not currently authorized/);
            });
        });
    });

    describe('deletion', () => {
        let allPromotions: PromotionListItem[];
        let promotionToDelete: PromotionListItem;

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const result = await adminClient.query(getPromotionListDocument);
            allPromotions = result.promotions.items;
        });

        it('deletes a promotion', async () => {
            promotionToDelete = allPromotions[0];
            const result = await adminClient.query(deletePromotionDocument, {
                id: promotionToDelete.id,
            });

            expect(result.deletePromotion).toEqual({
                result: DeletionResult.DELETED,
            });
        });

        it('cannot get a deleted promotion', async () => {
            const result = await adminClient.query(getPromotionDocument, {
                id: promotionToDelete.id,
            });

            expect(result.promotion).toBe(null);
        });

        it('deleted promotion omitted from list', async () => {
            const result = await adminClient.query(getPromotionListDocument);

            expect(result.promotions.items.length).toBe(allPromotions.length - 1);
            expect(result.promotions.items.map(c => c.id).includes(promotionToDelete.id)).toBe(false);
        });

        it(
            'updatePromotion throws for deleted promotion',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(updatePromotionDocument, {
                        input: {
                            id: promotionToDelete.id,
                            enabled: false,
                        },
                    }),
                'No Promotion with the id "1" could be found',
            ),
        );
    });
});

function generateTestCondition(code: string): PromotionCondition {
    return new PromotionCondition({
        code,
        description: [{ languageCode: LanguageCode.en, value: `description for ${code}` }],
        args: { arg: { type: 'int' } },
        check: () => true,
    });
}

function generateTestAction(code: string): PromotionAction<any> {
    return new PromotionOrderAction({
        code,
        description: [{ languageCode: LanguageCode.en, value: `description for ${code}` }],
        args: { facetValueIds: { type: 'ID', list: true } },
        execute: () => {
            return 42;
        },
    });
}
