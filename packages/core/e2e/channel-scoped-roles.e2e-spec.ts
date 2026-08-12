/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { mergeConfig } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment, roleFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql } from './graphql/graphql-admin';
import {
    assignProductToChannelDocument,
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    getProductListDocument,
    MeDocument,
    updateAdministratorDocument,
    updateProductDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const getRolesDocument = graphql(
    `
        query GetRolesChannelScoped($options: RoleListOptions) {
            roles(options: $options) {
                items {
                    ...Role
                }
                totalItems
            }
        }
    `,
    [roleFragment],
);

const administratorChannelRolesDocument = graphql(`
    query AdministratorChannelRoles($id: ID!) {
        administrator(id: $id) {
            id
            user {
                id
                roles {
                    id
                    code
                }
            }
            channelRoles {
                role {
                    id
                    code
                }
                channels {
                    id
                    code
                }
            }
        }
    }
`);

// OSS-300 — a Role may be shared between Channels while each Administrator stays restricted to the
// Channels they were explicitly granted.
describe('Channel-scoped roles', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: {
                channelScopedRoles: true,
            },
        }),
    );

    type ChannelFragment = FragmentOf<typeof channelFragment>;
    const channelGuard: ErrorResultGuard<ChannelFragment> = createErrorResultGuard(
        input => !!input.defaultLanguageCode,
    );

    const PASSWORD = 'test';
    let channelAToken: string;
    let channelBToken: string;
    let channelAId: string;
    let channelBId: string;
    let catalogManagerRoleId: string;
    let adminManagerRoleId: string;
    let adminAId: string;
    let adminBId: string;
    let productId: string;

    async function createChannel(code: string) {
        const { createChannel: result } = await adminClient.query(createChannelDocument, {
            input: {
                code,
                token: `${code}-token`,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.USD,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        channelGuard.assertSuccess(result);
        return result;
    }

    async function createScopedAdmin(emailAddress: string, roleId: string, channelIds: string[]) {
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress,
                firstName: emailAddress,
                lastName: 'Admin',
                password: PASSWORD,
                // No directly-assigned Roles: everything comes from the channel-scoped assignment.
                roleIds: [],
                channelRoles: [{ roleId, channelIds }],
            },
        });
        return createAdministrator;
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const channelA = await createChannel('channel-a');
        const channelB = await createChannel('channel-b');
        channelAId = channelA.id;
        channelBId = channelB.id;
        channelAToken = channelA.token;
        channelBToken = channelB.token;

        // A single Role shared between both channels. Under the default behaviour this would grant both
        // channels to every holder of the Role.
        const { createRole: catalogManager } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'catalog-manager',
                description: 'Catalog Manager',
                permissions: [Permission.ReadCatalog, Permission.UpdateCatalog],
                channelIds: [channelAId, channelBId],
            },
        });
        catalogManagerRoleId = catalogManager.id;

        const { createRole: adminManager } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'admin-manager',
                description: 'Administrator Manager',
                permissions: [
                    Permission.ReadCatalog,
                    Permission.UpdateCatalog,
                    Permission.ReadAdministrator,
                    Permission.CreateAdministrator,
                    Permission.UpdateAdministrator,
                ],
                channelIds: [channelAId, channelBId],
            },
        });
        adminManagerRoleId = adminManager.id;

        const { products } = await adminClient.query(getProductListDocument, { options: { take: 1 } });
        productId = products.items[0].id;
        await adminClient.query(assignProductToChannelDocument, {
            input: { productIds: [productId], channelId: channelAId },
        });
        await adminClient.query(assignProductToChannelDocument, {
            input: { productIds: [productId], channelId: channelBId },
        });

        const adminA = await createScopedAdmin('admin-a@test.com', catalogManagerRoleId, [channelAId]);
        const adminB = await createScopedAdmin('admin-b@test.com', catalogManagerRoleId, [channelBId]);
        adminAId = adminA.id;
        adminBId = adminB.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('the shared Role is granted on only the assigned Channel', async () => {
        await adminClient.asUserWithCredentials('admin-a@test.com', PASSWORD);
        const { me } = await adminClient.query(MeDocument);

        expect(me!.channels.map(c => c.code)).toEqual(['channel-a']);
        expect(me!.channels[0].permissions).toEqual(
            expect.arrayContaining([Permission.ReadCatalog, Permission.UpdateCatalog]),
        );
    });

    it('a scoped Administrator can act on their own Channel', async () => {
        await adminClient.asUserWithCredentials('admin-a@test.com', PASSWORD);
        adminClient.setChannelToken(channelAToken);

        const { updateProduct } = await adminClient.query(updateProductDocument, {
            input: { id: productId, translations: [{ languageCode: LanguageCode.en, name: 'Renamed by A' }] },
        });

        expect(updateProduct.name).toBe('Renamed by A');
    });

    it(
        'a scoped Administrator cannot act on another Channel which shares the same Role',
        assertThrowsWithMessage(async () => {
            await adminClient.asUserWithCredentials('admin-a@test.com', PASSWORD);
            adminClient.setChannelToken(channelBToken);
            await adminClient.query(updateProductDocument, {
                input: {
                    id: productId,
                    translations: [{ languageCode: LanguageCode.en, name: 'Should not happen' }],
                },
            });
        }, 'You are not currently authorized to perform this action'),
    );

    it('two Administrators sharing a Role are isolated from each other', async () => {
        await adminClient.asUserWithCredentials('admin-b@test.com', PASSWORD);
        const { me } = await adminClient.query(MeDocument);

        expect(me!.channels.map(c => c.code)).toEqual(['channel-b']);
    });

    it('Administrator.channelRoles reports the channel-scoped assignments grouped by Role', async () => {
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { administrator } = await adminClient.query(administratorChannelRolesDocument, {
            id: adminAId,
        });

        expect(administrator!.user.roles).toEqual([]);
        expect(administrator!.channelRoles.length).toBe(1);
        expect(administrator!.channelRoles[0].role.code).toBe('catalog-manager');
        expect(administrator!.channelRoles[0].channels.map(c => c.code)).toEqual(['channel-a']);
    });

    it('updating channelRoles replaces the previous assignments', async () => {
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(updateAdministratorDocument, {
            input: {
                id: adminBId,
                channelRoles: [{ roleId: catalogManagerRoleId, channelIds: [channelAId, channelBId] }],
            },
        });

        const { administrator } = await adminClient.query(administratorChannelRolesDocument, {
            id: adminBId,
        });
        expect(administrator!.channelRoles[0].channels.map(c => c.code).sort()).toEqual([
            'channel-a',
            'channel-b',
        ]);

        // restore
        await adminClient.query(updateAdministratorDocument, {
            input: {
                id: adminBId,
                channelRoles: [{ roleId: catalogManagerRoleId, channelIds: [channelBId] }],
            },
        });
    });

    it('a scoped Administrator can read a shared Role in order to grant it', async () => {
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await createScopedAdmin('admin-manager-a@test.com', adminManagerRoleId, [channelAId]);

        await adminClient.asUserWithCredentials('admin-manager-a@test.com', PASSWORD);
        adminClient.setChannelToken(channelAToken);
        const { roles } = await adminClient.query(getRolesDocument);

        expect(roles.items.map(r => r.code)).toContain('catalog-manager');
    });

    it('a scoped Administrator cannot read a Role whose permissions they do not hold', async () => {
        await adminClient.asUserWithCredentials('admin-manager-a@test.com', PASSWORD);
        adminClient.setChannelToken(channelAToken);
        const { roles } = await adminClient.query(getRolesDocument);

        expect(roles.items.map(r => r.code)).not.toContain(SUPER_ADMIN_ROLE_CODE);
    });

    it(
        'a scoped Administrator cannot grant a Role on a Channel they have no permissions on',
        assertThrowsWithMessage(async () => {
            await adminClient.asUserWithCredentials('admin-manager-a@test.com', PASSWORD);
            adminClient.setChannelToken(channelAToken);
            await adminClient.query(createAdministratorDocument, {
                input: {
                    emailAddress: 'escalation@test.com',
                    firstName: 'Escalation',
                    lastName: 'Attempt',
                    password: PASSWORD,
                    roleIds: [],
                    channelRoles: [{ roleId: catalogManagerRoleId, channelIds: [channelBId] }],
                },
            });
        }, 'Active user does not have sufficient permissions'),
    );

    it(
        'a Role which does not apply to every Channel cannot be assigned directly',
        assertThrowsWithMessage(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(createAdministratorDocument, {
                input: {
                    emailAddress: 'global-slot@test.com',
                    firstName: 'Global',
                    lastName: 'Slot',
                    password: PASSWORD,
                    roleIds: [catalogManagerRoleId],
                },
            });
        }, 'The role "catalog-manager" does not apply to every Channel, so it must be granted per Channel via channelRoles'),
    );

    it('the SuperAdmin role still applies on every Channel when assigned directly', async () => {
        await adminClient.asSuperAdmin();
        const { me } = await adminClient.query(MeDocument);

        expect(me!.channels.map(c => c.code)).toEqual(
            expect.arrayContaining(['__default_channel__', 'channel-a', 'channel-b']),
        );
    });
});
