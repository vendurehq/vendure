import {
    CurrencyCode,
    DeletionResult,
    LanguageCode,
    Permission,
    SortOrder,
} from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_IDENTIFIER } from '@vendure/common/lib/shared-constants';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql } from './graphql/graphql-admin';
import {
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    deleteAdministratorDocument,
    getActiveAdministratorDocument,
    getAdministratorDocument,
    getAdministratorsDocument,
    updateAdministratorDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const assignRoleToAdministratorDocument = graphql(`
    mutation AssignRoleToAdministrator($administratorId: ID!, $roleId: ID!) {
        assignRoleToAdministrator(administratorId: $administratorId, roleId: $roleId) {
            id
        }
    }
`);

/**
 * An Administrator must only be visible to an active user who already holds every Permission of
 * every Role of that Administrator, on every Channel of those Roles. This is the same rule which
 * governs updating an Administrator, so the read and write policies cannot drift apart.
 *
 * This uses a dedicated environment rather than folding into administrator.e2e-spec.ts, because that
 * suite asserts fixed Administrator counts across its sequential tests.
 */
describe('Administrator visibility', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    const CHANNEL_A_TOKEN = 'channel_a_token';
    const CHANNEL_B_TOKEN = 'channel_b_token';

    const channelAAdmin = { emailAddress: 'channel-a-admin@test.com', password: 'test-password' };
    const channelAStaff = { emailAddress: 'channel-a-staff@test.com', password: 'test-password' };
    const bothChannelsAdmin = { emailAddress: 'both-channels-admin@test.com', password: 'test-password' };
    const bothChannelsStaff = { emailAddress: 'both-channels-staff@test.com', password: 'test-password' };

    let superAdminId: string;
    let channelAAdminId: string;
    let bothChannelsAdminId: string;
    let channelAStaffId: string;
    let channelBStaffId: string;
    let bothChannelsStaffId: string;
    let noRolesAdminId: string;
    let channelAStaffRoleId: string;

    const channelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard(
        input => !!input.defaultLanguageCode,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { administrators } = await adminClient.query(getAdministratorsDocument);
        const superAdmin = administrators.items.find(a => a.user.identifier === SUPER_ADMIN_USER_IDENTIFIER);
        if (!superAdmin) {
            throw new Error('Could not find the SuperAdmin');
        }
        superAdminId = superAdmin.id;

        const { createChannel: channelA } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'channel-a',
                token: CHANNEL_A_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        const { createChannel: channelB } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'channel-b',
                token: CHANNEL_B_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        channelGuard.assertSuccess(channelA);
        channelGuard.assertSuccess(channelB);
        const channelAId = channelA.id;
        const channelBId = channelB.id;

        // Can administer Administrators on Channel A only.
        const { createRole: channelAAdminRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-a-admin',
                description: 'Manages administrators of Channel A',
                permissions: [
                    Permission.ReadCatalog,
                    Permission.CreateAdministrator,
                    Permission.ReadAdministrator,
                    Permission.UpdateAdministrator,
                    Permission.DeleteAdministrator,
                ],
                channelIds: [channelAId],
            },
        });
        // The same authority, but on both Channels.
        const { createRole: bothChannelsAdminRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'both-channels-admin',
                description: 'Manages administrators of both Channels',
                permissions: [
                    Permission.ReadCatalog,
                    Permission.CreateAdministrator,
                    Permission.ReadAdministrator,
                    Permission.UpdateAdministrator,
                    Permission.DeleteAdministrator,
                ],
                channelIds: [channelAId, channelBId],
            },
        });
        // Can read Administrators on Channel A, but holds less than channel-a-admin does.
        const { createRole: channelAStaffRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-a-staff',
                description: 'Catalog staff of Channel A',
                permissions: [Permission.ReadCatalog, Permission.ReadAdministrator],
                channelIds: [channelAId],
            },
        });
        const { createRole: channelBStaffRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-b-staff',
                description: 'Catalog staff of Channel B',
                permissions: [Permission.ReadCatalog],
                channelIds: [channelBId],
            },
        });

        channelAStaffRoleId = channelAStaffRole.id;

        const { createAdministrator: aAdmin } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: channelAAdmin.emailAddress,
                firstName: 'Alice',
                lastName: 'ChannelA',
                password: channelAAdmin.password,
                roleIds: [channelAAdminRole.id],
            },
        });
        channelAAdminId = aAdmin.id;

        const { createAdministrator: abAdmin } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: bothChannelsAdmin.emailAddress,
                firstName: 'Bob',
                lastName: 'BothChannels',
                password: bothChannelsAdmin.password,
                roleIds: [bothChannelsAdminRole.id],
            },
        });
        bothChannelsAdminId = abAdmin.id;

        const { createAdministrator: aStaff } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: channelAStaff.emailAddress,
                firstName: 'Carol',
                lastName: 'StaffA',
                password: channelAStaff.password,
                roleIds: [channelAStaffRole.id],
            },
        });
        channelAStaffId = aStaff.id;

        const { createAdministrator: bStaff } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: 'channel-b-staff@test.com',
                firstName: 'Dave',
                lastName: 'StaffB',
                password: 'test-password',
                roleIds: [channelBStaffRole.id],
            },
        });
        channelBStaffId = bStaff.id;

        // Holds a Role of each Channel, so one visible Role and one hidden Role for a Channel A
        // administrator.
        const { createAdministrator: abStaff } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: bothChannelsStaff.emailAddress,
                firstName: 'Frank',
                lastName: 'StaffAB',
                password: bothChannelsStaff.password,
                roleIds: [channelAStaffRole.id, channelBStaffRole.id],
            },
        });
        bothChannelsStaffId = abStaff.id;

        // An Administrator with no Roles at all. There is nothing to check them against, so they
        // are visible to any holder of ReadAdministrator.
        const { createAdministrator: noRoles } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: 'no-roles-admin@test.com',
                firstName: 'Erin',
                lastName: 'NoRoles',
                password: 'test-password',
                roleIds: [],
            },
        });
        noRolesAdminId = noRoles.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('administrator scoped to a single Channel', () => {
        beforeAll(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asUserWithCredentials(channelAAdmin.emailAddress, channelAAdmin.password);
        });

        it('administrators omits Administrators of other Channels', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument);

            const visibleIds = administrators.items.map(a => a.id);
            expect(visibleIds).not.toContain(channelBStaffId);
            expect(visibleIds).not.toContain(superAdminId);
            expect(visibleIds).not.toContain(bothChannelsAdminId);
            expect(visibleIds).toEqual(expect.arrayContaining([channelAAdminId, channelAStaffId]));
        });

        it('administrators omits an Administrator who holds a hidden Role beside a visible one', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument);

            expect(administrators.items.map(a => a.id)).not.toContain(bothChannelsStaffId);
        });

        it('administrators includes an Administrator with no Roles', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument);

            expect(administrators.items.map(a => a.id)).toContain(noRolesAdminId);
        });

        it('totalItems counts only visible Administrators', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument);

            expect(administrators.totalItems).toBe(3);
            expect(administrators.items.length).toBe(3);
        });

        it('administrator returns null for an Administrator of another Channel', async () => {
            const { administrator } = await adminClient.query(getAdministratorDocument, {
                id: channelBStaffId,
            });

            expect(administrator).toBeNull();
        });

        it('administrator returns null for an Administrator who holds a hidden Role beside a visible one', async () => {
            const { administrator } = await adminClient.query(getAdministratorDocument, {
                id: bothChannelsStaffId,
            });

            expect(administrator).toBeNull();
        });

        it('administrator returns null for the SuperAdmin', async () => {
            const { administrator } = await adminClient.query(getAdministratorDocument, {
                id: superAdminId,
            });

            expect(administrator).toBeNull();
        });

        it('administrator returns a visible Administrator', async () => {
            const { administrator } = await adminClient.query(getAdministratorDocument, {
                id: channelAStaffId,
            });

            expect(administrator?.id).toBe(channelAStaffId);
        });

        it('activeAdministrator still resolves', async () => {
            const { activeAdministrator } = await adminClient.query(getActiveAdministratorDocument);

            expect(activeAdministrator?.id).toBe(channelAAdminId);
            expect(activeAdministrator?.user.roles.map(r => r.code)).toEqual(['channel-a-admin']);
        });

        it(
            'updateAdministrator reports an Administrator of another Channel as not found',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateAdministratorDocument, {
                    input: { id: channelBStaffId, firstName: 'Pwned' },
                });
            }, 'could be found'),
        );

        it(
            'assignRoleToAdministrator reports an Administrator of another Channel as not found',
            assertThrowsWithMessage(async () => {
                await adminClient.query(assignRoleToAdministratorDocument, {
                    administratorId: channelBStaffId,
                    roleId: channelAStaffRoleId,
                });
            }, 'could be found'),
        );

        it(
            'deleteAdministrator reports an Administrator of another Channel as not found',
            assertThrowsWithMessage(async () => {
                await adminClient.query(deleteAdministratorDocument, {
                    id: channelBStaffId,
                });
            }, 'could be found'),
        );

        it('createAdministrator succeeds with a Role of its own Channel', async () => {
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    emailAddress: 'created-by-channel-a-admin@test.com',
                    firstName: 'Grace',
                    lastName: 'CreatedA',
                    password: 'test-password',
                    roleIds: [channelAStaffRoleId],
                },
            });

            expect(createAdministrator.user.roles.map(r => r.code)).toEqual(['channel-a-staff']);

            const { deleteAdministrator } = await adminClient.query(deleteAdministratorDocument, {
                id: createAdministrator.id,
            });
            expect(deleteAdministrator.result).toBe(DeletionResult.DELETED);
        });

        it('leaves the Administrator of the other Channel in place', async () => {
            await adminClient.asSuperAdmin();
            const { administrator } = await adminClient.query(getAdministratorDocument, {
                id: channelBStaffId,
            });

            expect(administrator?.id).toBe(channelBStaffId);
            expect(administrator?.emailAddress).toBe('channel-b-staff@test.com');
        });
    });

    describe('administrator with narrower permissions than a colleague on the same Channel', () => {
        beforeAll(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asUserWithCredentials(channelAStaff.emailAddress, channelAStaff.password);
        });

        it('administrators omits the colleague with broader permissions', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument);

            expect(administrators.items.map(a => a.id).sort()).toEqual(
                [channelAStaffId, noRolesAdminId].sort(),
            );
            expect(administrators.totalItems).toBe(2);
        });

        it('administrator returns null for the colleague with broader permissions', async () => {
            const { administrator } = await adminClient.query(getAdministratorDocument, {
                id: channelAAdminId,
            });

            expect(administrator).toBeNull();
        });
    });

    describe('administrator with authority on both Channels', () => {
        beforeAll(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asUserWithCredentials(
                bothChannelsAdmin.emailAddress,
                bothChannelsAdmin.password,
            );
        });

        it('sees Administrators of both Channels', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument);

            const visibleIds = administrators.items.map(a => a.id);
            expect(visibleIds).toEqual(
                expect.arrayContaining([
                    bothChannelsAdminId,
                    channelAAdminId,
                    channelAStaffId,
                    channelBStaffId,
                    bothChannelsStaffId,
                ]),
            );
            expect(visibleIds).not.toContain(superAdminId);
            expect(administrators.totalItems).toBe(6);
        });

        it('administrator returns an Administrator of the other Channel', async () => {
            const { administrator } = await adminClient.query(getAdministratorDocument, {
                id: channelBStaffId,
            });

            expect(administrator?.id).toBe(channelBStaffId);
        });

        it('sorting and pagination operate over the visible Administrators only', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument, {
                options: {
                    sort: { emailAddress: SortOrder.ASC },
                    take: 2,
                },
            });

            expect(administrators.totalItems).toBe(6);
            expect(administrators.items.map(a => a.emailAddress)).toEqual([
                bothChannelsAdmin.emailAddress,
                bothChannelsStaff.emailAddress,
            ]);
        });

        it('filtering operates over the visible Administrators only', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument, {
                options: {
                    filter: { emailAddress: { contains: 'staff' } },
                    sort: { emailAddress: SortOrder.ASC },
                },
            });

            expect(administrators.totalItems).toBe(3);
            expect(administrators.items.map(a => a.emailAddress)).toEqual([
                bothChannelsStaff.emailAddress,
                channelAStaff.emailAddress,
                'channel-b-staff@test.com',
            ]);
        });
    });

    describe('SuperAdmin', () => {
        beforeAll(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asSuperAdmin();
        });

        it('still sees every Administrator', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument);

            expect(administrators.totalItems).toBe(7);
            expect(administrators.items.map(a => a.id)).toEqual(
                expect.arrayContaining([
                    superAdminId,
                    channelAAdminId,
                    bothChannelsAdminId,
                    channelAStaffId,
                    channelBStaffId,
                    bothChannelsStaffId,
                    noRolesAdminId,
                ]),
            );
        });

        it('still retrieves any Administrator', async () => {
            const { administrator } = await adminClient.query(getAdministratorDocument, {
                id: channelBStaffId,
            });

            expect(administrator?.id).toBe(channelBStaffId);
        });
    });
});
