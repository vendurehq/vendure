/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    CurrencyCode,
    DeletionResult,
    ErrorCode,
    LanguageCode,
    Permission,
} from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import { ResultOf } from 'gql.tada';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql } from './graphql/graphql-admin';
import {
    assignProductToChannelDocument,
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    getChannelsDocument,
    getCustomerListDocument,
    getProductListDocument,
    getProductWithVariantsDocument,
    MeDocument,
    updateChannelDocument,
} from './graphql/shared-definitions';
import { getActiveOrderDocument } from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

describe('Channels', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());
    const SECOND_CHANNEL_TOKEN = 'second_channel_token';

    let secondChannelAdminRole: ResultOf<typeof createRoleDocument>['createRole'];
    let customerUser: ResultOf<typeof getCustomerListDocument>['customers']['items'][number];

    type ChannelFragment = FragmentOf<typeof channelFragment>;

    const channelGuard: ErrorResultGuard<ChannelFragment> = createErrorResultGuard(
        input => !!input.defaultLanguageCode,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: { take: 1 },
        });
        customerUser = customers.items[0];
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('createChannel returns error result defaultLanguageCode not available', async () => {
        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'second-channel',
                token: SECOND_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.zh,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        channelGuard.assertErrorResult(createChannel);

        expect(createChannel.message).toBe(
            'Language "zh" is not available. First enable it via GlobalSettings and try again',
        );
        expect(createChannel.errorCode).toBe(ErrorCode.LANGUAGE_NOT_AVAILABLE_ERROR);
        expect(createChannel.languageCode).toBe('zh');
    });

    it('create a new Channel', async () => {
        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'second-channel',
                token: SECOND_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        channelGuard.assertSuccess(createChannel);

        expect(createChannel).toEqual({
            id: 'T_2',
            code: 'second-channel',
            token: SECOND_CHANNEL_TOKEN,
            availableCurrencyCodes: ['GBP'],
            currencyCode: 'GBP',
            defaultCurrencyCode: 'GBP',
            defaultLanguageCode: 'en',
            defaultShippingZone: {
                id: 'T_1',
            },
            defaultTaxZone: {
                id: 'T_1',
            },
            pricesIncludeTax: true,
        });
    });

    // it('update currencyCode', async () => {
    //     const { updateChannel } = await adminClient.query<
    //         Codegen.UpdateChannelMutation,
    //         Codegen.UpdateChannelMutationVariables
    //     >(updateChannelDocument, {
    //         input: {
    //             id: 'T_1',
    //             currencyCode: CurrencyCode.MYR,
    //         },
    //     });
    //     channelGuard.assertSuccess(updateChannel);
    //     expect(updateChannel.currencyCode).toBe('MYR');
    // });

    it('superadmin has all permissions on new channel', async () => {
        const { me } = await adminClient.query(MeDocument);

        expect(me!.channels.length).toBe(2);

        const secondChannelData = me!.channels.find(c => c.token === SECOND_CHANNEL_TOKEN);
        const nonOwnerPermissions = Object.values(Permission).filter(
            p => p !== Permission.Owner && p !== Permission.Public,
        );
        expect(secondChannelData!.permissions.sort()).toEqual(nonOwnerPermissions);
    });

    it('customer has Authenticated permission on new channel', async () => {
        await shopClient.asUserWithCredentials(customerUser.emailAddress, 'test');
        const { me } = await shopClient.query(MeDocument);

        expect(me!.channels.length).toBe(2);

        expect(me!.channels).toEqual([
            {
                code: DEFAULT_CHANNEL_CODE,
                permissions: ['Authenticated'],
                token: E2E_DEFAULT_CHANNEL_TOKEN,
            },
            {
                code: 'second-channel',
                permissions: ['Authenticated'],
                token: SECOND_CHANNEL_TOKEN,
            },
        ]);
    });

    it('createRole on second Channel', async () => {
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                description: 'second channel admin',
                code: 'second-channel-admin',
                channelIds: ['T_2'],
                permissions: [
                    Permission.ReadCatalog,
                    Permission.ReadSettings,
                    Permission.ReadAdministrator,
                    Permission.CreateAdministrator,
                    Permission.UpdateAdministrator,
                ],
            },
        });

        expect(createRole.channels).toEqual([
            {
                id: 'T_2',
                code: 'second-channel',
                token: SECOND_CHANNEL_TOKEN,
            },
        ]);

        secondChannelAdminRole = createRole;
    });

    it('createAdministrator with second-channel-admin role', async () => {
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Admin',
                lastName: 'Two',
                emailAddress: 'admin2@test.com',
                password: 'test',
                roleIds: [secondChannelAdminRole.id],
            },
        });

        expect(createAdministrator.user.roles.map(r => r.description)).toEqual(['second channel admin']);
    });

    it(
        'cannot create role on channel for which admin does not have CreateAdministrator permission',
        assertThrowsWithMessage(async () => {
            await adminClient.asUserWithCredentials('admin2@test.com', 'test');
            await adminClient.query(createRoleDocument, {
                input: {
                    description: 'read default channel catalog',
                    code: 'read default channel catalog',
                    channelIds: ['T_1'],
                    permissions: [Permission.ReadCatalog],
                },
            });
        }, 'You are not currently authorized to perform this action'),
    );

    it('can create role on channel for which admin has CreateAdministrator permission', async () => {
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                description: 'read second channel catalog',
                code: 'read-second-channel-catalog',
                channelIds: ['T_2'],
                permissions: [Permission.ReadCatalog],
            },
        });

        expect(createRole.channels).toEqual([
            {
                id: 'T_2',
                code: 'second-channel',
                token: SECOND_CHANNEL_TOKEN,
            },
        ]);
    });

    it('createRole with no channelId implicitly uses active channel', async () => {
        await adminClient.asSuperAdmin();
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                description: 'update second channel catalog',
                code: 'update-second-channel-catalog',
                permissions: [Permission.UpdateCatalog],
            },
        });

        expect(createRole.channels).toEqual([
            {
                id: 'T_2',
                code: 'second-channel',
                token: SECOND_CHANNEL_TOKEN,
            },
        ]);
    });

    describe('setting defaultLanguage', () => {
        it('returns error result if languageCode not in availableLanguages', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { updateChannel } = await adminClient.query(updateChannelDocument, {
                input: {
                    id: 'T_1',
                    defaultLanguageCode: LanguageCode.zh,
                },
            });
            channelGuard.assertErrorResult(updateChannel);

            expect(updateChannel.message).toBe(
                'Language "zh" is not available. First enable it via GlobalSettings and try again',
            );
            expect(updateChannel.errorCode).toBe(ErrorCode.LANGUAGE_NOT_AVAILABLE_ERROR);
            expect(updateChannel.languageCode).toBe('zh');
        });

        it('allows setting to an available language', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(updateGlobalLanguagesDocument, {
                input: {
                    availableLanguages: [LanguageCode.en, LanguageCode.zh],
                },
            });

            const { updateChannel } = await adminClient.query(updateChannelDocument, {
                input: {
                    id: 'T_1',
                    defaultLanguageCode: LanguageCode.zh,
                },
            });
            channelGuard.assertSuccess(updateChannel);
            expect(updateChannel.defaultLanguageCode).toBe(LanguageCode.zh);
        });
    });

    it('deleteChannel', async () => {
        const PROD_ID = 'T_1';
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

        const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
            input: {
                channelId: 'T_2',
                productIds: [PROD_ID],
            },
        });
        expect(assignProductsToChannel[0].channels.map(c => c.id).sort()).toEqual(['T_1', 'T_2']);

        // create a Session on the Channel to be deleted to ensure it gets cleaned up
        shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        await shopClient.query(getActiveOrderDocument);

        const { deleteChannel } = await adminClient.query(deleteChannelDocument, {
            id: 'T_2',
        });

        expect(deleteChannel.result).toBe(DeletionResult.DELETED);

        const { channels } = await adminClient.query(getChannelsDocument);
        expect(channels.items.map(c => c.id).sort()).toEqual(['T_1']);

        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: PROD_ID,
        });
        expect(product!.channels.map(c => c.id)).toEqual(['T_1']);
    });

    it('Fail to delete the default channel', async () => {
        await adminClient.asSuperAdmin();

        const defaultChannelId = (await adminClient.query(getChannelsDocument)).channels.items.find(
            channel => channel.code === DEFAULT_CHANNEL_CODE,
        )?.id;

        expect(defaultChannelId).not.toBeUndefined();

        const mutation = await adminClient.query(deleteChannelDocument, { id: defaultChannelId! });

        expect(mutation.deleteChannel).toEqual({
            result: DeletionResult.NOT_DELETED,
            message: 'The default Channel cannot be deleted',
        });
    });

    describe('currencyCode support', () => {
        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });

        it('initial currencyCode values', async () => {
            const { channel } = await adminClient.query(getChannelDocument, {
                id: 'T_1',
            });

            expect(channel?.defaultCurrencyCode).toBe('USD');
            expect(channel?.availableCurrencyCodes).toEqual(['USD']);
        });

        it('setting defaultCurrencyCode adds it to availableCurrencyCodes', async () => {
            const { updateChannel } = await adminClient.query(updateChannelDocument, {
                input: {
                    id: 'T_1',
                    defaultCurrencyCode: CurrencyCode.MYR,
                },
            });
            channelGuard.assertSuccess(updateChannel);
            expect(updateChannel.defaultCurrencyCode).toBe('MYR');
            expect(updateChannel.currencyCode).toBe('MYR');
            expect(updateChannel.availableCurrencyCodes).toEqual(['USD', 'MYR']);
        });

        it('setting defaultCurrencyCode adds it to availableCurrencyCodes 2', async () => {
            // As above, but this time we set the availableCurrencyCodes explicitly
            // to exclude the defaultCurrencyCode
            const { updateChannel } = await adminClient.query(updateChannelDocument, {
                input: {
                    id: 'T_1',
                    defaultCurrencyCode: CurrencyCode.AUD,
                    availableCurrencyCodes: [CurrencyCode.GBP],
                },
            });
            channelGuard.assertSuccess(updateChannel);
            expect(updateChannel.defaultCurrencyCode).toBe('AUD');
            expect(updateChannel.currencyCode).toBe('AUD');
            expect(updateChannel.availableCurrencyCodes).toEqual(['GBP', 'AUD']);
        });

        it(
            'cannot remove the defaultCurrencyCode from availableCurrencyCodes',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateChannelDocument, {
                    input: {
                        id: 'T_1',
                        availableCurrencyCodes: [CurrencyCode.GBP],
                    },
                });
            }, 'availableCurrencyCodes must include the defaultCurrencyCode (AUD)'),
        );

        it(
            'specifying an unsupported currencyCode throws',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    getProductListDocument,
                    {
                        options: {
                            take: 1,
                        },
                    },
                    { currencyCode: 'JPY' },
                );
            }, 'The currency "JPY" is not available in the current Channel'),
        );
    });
});

const deleteChannelDocument = graphql(`
    mutation DeleteChannel($id: ID!) {
        deleteChannel(id: $id) {
            message
            result
        }
    }
`);

const getChannelDocument = graphql(`
    query GetChannel($id: ID!) {
        channel(id: $id) {
            id
            code
            token
            defaultCurrencyCode
            availableCurrencyCodes
            defaultLanguageCode
            availableLanguageCodes
            outOfStockThreshold
            pricesIncludeTax
        }
    }
`);

const updateGlobalLanguagesDocument = graphql(`
    mutation UpdateGlobalLanguages($input: UpdateGlobalSettingsInput!) {
        updateGlobalSettings(input: $input) {
            ... on GlobalSettings {
                id
                availableLanguages
            }
        }
    }
`);
