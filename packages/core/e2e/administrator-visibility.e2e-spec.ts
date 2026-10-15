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
 * An Administrator must only be visible to an active user who may grant every RoleAssignment
 * that Administrator holds: for each (Role, Channel) row, the active user holds every Permission
 * of the Role on that Channel. This is the same rule which governs updating an Administrator, so
 * the read and write policies cannot drift apart.
 *
 * This uses a dedicated environment rather than folding into administrator.e2e-spec.ts, because that
 * suite asserts fixed Administrator counts across its sequential tests.
 */
// GHSA-37j3-p93w-fq6w — Administrator reads are scoped to the active user's authority.
describe('Administrator visibility', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    const CHANNEL_A_TOKEN = 'channel_a_token';
    const CHANNEL_B_TOKEN = 'channel_b_token';

    const channelAAdmin = { emailAddress: 'channel-a-admin@test.com', password: 'test-password' };
    const channelBAdmin = { emailAddress: 'channel-b-admin@test.com', password: 'test-password' };
    const channelAStaff = { emailAddress: 'channel-a-staff@test.com', password: 'test-password' };
    const bothChannelsAdmin = { emailAddress: 'both-channels-admin@test.com', password: 'test-password' };
    const bothChannelsStaff = { emailAddress: 'both-channels-staff@test.com', password: 'test-password' };

    let superAdminId: string;
    let channelAAdminId: string;
    let channelBAdminId: string;
    let bothChannelsAdminId: string;
    let channelAStaffId: string;
    let channelBStaffId: string;
    let bothChannelsStaffId: string;
    let noRolesAdminId: string;
    let channelAId: string;
    let staffRoleId: string;

    const channelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard(
        input => !!input.defaultLanguageCode,
    );

    async function createTestChannel(code: string, token: string) {
        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code,
                token,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        channelGuard.assertSuccess(createChannel);
        return createChannel.id;
    }

    async function createTestAdministrator(
        emailAddress: string,
        firstName: string,
        roleAssignments: Array<{ roleId: string; channelId: string }>,
    ) {
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: { emailAddress, firstName, lastName: 'Test', password: 'test-password', roleAssignments },
        });
        return createAdministrator.id;
    }

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

        channelAId = await createTestChannel('channel-a', CHANNEL_A_TOKEN);
        const channelBId = await createTestChannel('channel-b', CHANNEL_B_TOKEN);

        // Roles carry no Channels: the Channel is on each RoleAssignment row, so the same Role is
        // assigned on Channel A, Channel B or both below.
        const { createRole: adminManagerRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'admin-manager',
                description: 'Manages administrators',
                permissions: [
                    Permission.ReadCatalog,
                    Permission.CreateAdministrator,
                    Permission.ReadAdministrator,
                    Permission.UpdateAdministrator,
                    Permission.DeleteAdministrator,
                ],
            },
        });
        // Can read Administrators, but holds less than admin-manager does.
        const { createRole: staffRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'staff',
                description: 'Catalog staff who can read administrators',
                permissions: [Permission.ReadCatalog, Permission.ReadAdministrator],
            },
        });
        const { createRole: catalogRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'catalog',
                description: 'Catalog staff',
                permissions: [Permission.ReadCatalog],
            },
        });
        staffRoleId = staffRole.id;

        channelAAdminId = await createTestAdministrator(channelAAdmin.emailAddress, 'Alice', [
            { roleId: adminManagerRole.id, channelId: channelAId },
        ]);
        // The B-only counterpart of channelAAdmin.
        channelBAdminId = await createTestAdministrator(channelBAdmin.emailAddress, 'Bea', [
            { roleId: adminManagerRole.id, channelId: channelBId },
        ]);
        bothChannelsAdminId = await createTestAdministrator(bothChannelsAdmin.emailAddress, 'Bob', [
            { roleId: adminManagerRole.id, channelId: channelAId },
            { roleId: adminManagerRole.id, channelId: channelBId },
        ]);
        channelAStaffId = await createTestAdministrator(channelAStaff.emailAddress, 'Carol', [
            { roleId: staffRole.id, channelId: channelAId },
        ]);
        channelBStaffId = await createTestAdministrator('channel-b-staff@test.com', 'Dave', [
            { roleId: catalogRole.id, channelId: channelBId },
        ]);
        // Holds the same Role on both Channels, so one visible row and one hidden row for a
        // Channel A administrator.
        bothChannelsStaffId = await createTestAdministrator(bothChannelsStaff.emailAddress, 'Frank', [
            { roleId: staffRole.id, channelId: channelAId },
            { roleId: staffRole.id, channelId: channelBId },
        ]);
        // An Administrator with no RoleAssignments at all. There is nothing to check them against,
        // so they are visible to any holder of ReadAdministrator.
        noRolesAdminId = await createTestAdministrator('no-roles-admin@test.com', 'Erin', []);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // GHSA-37j3-p93w-fq6w — an actor with authority on Channel A only sees and modifies Channel A Administrators.
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

        it('administrators omits an Administrator who holds a hidden assignment beside a visible one', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument);

            expect(administrators.items.map(a => a.id)).not.toContain(bothChannelsStaffId);
        });

        it('administrators includes an Administrator with no assignments', async () => {
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

        it('administrator returns null for an Administrator who holds a hidden assignment beside a visible one', async () => {
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
            expect(activeAdministrator?.user.roles.map(r => r.code)).toEqual(['admin-manager']);
        });

        it(
            'updateAdministrator reports an Administrator of another Channel as not found',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateAdministratorDocument, {
                    input: { id: channelBStaffId, firstName: 'Pwned' },
                });
            }, 'could be found'),
        );

        // assignRoleToAdministrator is deprecated (since 4.0.0) and assigns on the active Channel.
        it(
            'assignRoleToAdministrator reports an Administrator of another Channel as not found',
            assertThrowsWithMessage(async () => {
                await adminClient.query(assignRoleToAdministratorDocument, {
                    administratorId: channelBStaffId,
                    roleId: staffRoleId,
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

        it('createAdministrator succeeds with an assignment on its own Channel', async () => {
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    emailAddress: 'created-by-channel-a-admin@test.com',
                    firstName: 'Grace',
                    lastName: 'CreatedA',
                    password: 'test-password',
                    roleAssignments: [{ roleId: staffRoleId, channelId: channelAId }],
                },
            });

            expect(createAdministrator.user.roles.map(r => r.code)).toEqual(['staff']);

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

    // GHSA-37j3-p93w-fq6w — authority needs every Permission of the target's Role, not just a shared Channel.
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

    // GHSA-37j3-p93w-fq6w — the filter runs in the list query, so counts, sorting and filtering agree with it.
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
                    channelBAdminId,
                    channelAStaffId,
                    channelBStaffId,
                    bothChannelsStaffId,
                    noRolesAdminId,
                ]),
            );
            expect(visibleIds).not.toContain(superAdminId);
            expect(administrators.totalItems).toBe(7);
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

            expect(administrators.totalItems).toBe(7);
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

    // GHSA-37j3-p93w-fq6w — per-actor rows against the B-only Administrator channelBStaff, who holds
    // the catalog Role on Channel B. Only an actor holding the catalog Permissions on Channel B
    // has authority over them; holding them on Channel A does not count.
    describe('per-actor access to a Channel B only Administrator', () => {
        const NOT_AUTHORIZED = 'You are not currently authorized to perform this action';
        const rows = [
            {
                name: 'admin-manager on Channel A only, active on Channel A',
                actor: channelAAdmin,
                channelToken: CHANNEL_A_TOKEN,
                expected: 'hidden',
            },
            // Switching the active Channel does not help: the actor holds nothing on Channel B.
            {
                name: 'admin-manager on Channel A only, active on Channel B',
                actor: channelAAdmin,
                channelToken: CHANNEL_B_TOKEN,
                expected: 'forbidden',
            },
            {
                name: 'admin-manager on Channel B only, active on Channel B',
                actor: channelBAdmin,
                channelToken: CHANNEL_B_TOKEN,
                expected: 'visible',
            },
        ] as const;

        for (const row of rows) {
            describe(row.name, () => {
                // login() switches the client to the user's first Channel, so the token is set after it.
                beforeAll(async () => {
                    await adminClient.asUserWithCredentials(row.actor.emailAddress, row.actor.password);
                    adminClient.setChannelToken(row.channelToken);
                });

                if (row.expected === 'forbidden') {
                    it(
                        'administrators is forbidden',
                        assertThrowsWithMessage(
                            () => adminClient.query(getAdministratorsDocument),
                            NOT_AUTHORIZED,
                        ),
                    );
                    it(
                        'administrator is forbidden',
                        assertThrowsWithMessage(
                            () => adminClient.query(getAdministratorDocument, { id: channelBStaffId }),
                            NOT_AUTHORIZED,
                        ),
                    );
                    it(
                        'updateAdministrator is forbidden',
                        assertThrowsWithMessage(
                            () =>
                                adminClient.query(updateAdministratorDocument, {
                                    input: { id: channelBStaffId, firstName: 'Pwned' },
                                }),
                            NOT_AUTHORIZED,
                        ),
                    );
                    return;
                }

                const visible = row.expected === 'visible';

                it(`administrators ${visible ? 'includes' : 'omits'} the Administrator`, async () => {
                    const { administrators } = await adminClient.query(getAdministratorsDocument);
                    const visibleIds = administrators.items.map(a => a.id);

                    if (visible) {
                        expect(visibleIds).toContain(channelBStaffId);
                    } else {
                        expect(visibleIds).not.toContain(channelBStaffId);
                    }
                });

                it(`administrator ${visible ? 'returns' : 'returns null for'} the Administrator`, async () => {
                    const { administrator } = await adminClient.query(getAdministratorDocument, {
                        id: channelBStaffId,
                    });

                    expect(administrator?.id ?? null).toBe(visible ? channelBStaffId : null);
                });

                if (visible) {
                    it('updateAdministrator updates the Administrator', async () => {
                        const { updateAdministrator } = await adminClient.query(updateAdministratorDocument, {
                            input: { id: channelBStaffId, firstName: 'UpdatedByChannelBAdmin' },
                        });

                        expect(updateAdministrator.id).toBe(channelBStaffId);
                        expect(updateAdministrator.firstName).toBe('UpdatedByChannelBAdmin');
                    });
                } else {
                    it(
                        'updateAdministrator reports the Administrator as not found',
                        assertThrowsWithMessage(
                            () =>
                                adminClient.query(updateAdministratorDocument, {
                                    input: { id: channelBStaffId, firstName: 'Pwned' },
                                }),
                            'could be found',
                        ),
                    );
                }
            });
        }
    });

    // GHSA-37j3-p93w-fq6w — the SuperAdmin is not restricted.
    describe('SuperAdmin', () => {
        beforeAll(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asSuperAdmin();
        });

        it('still sees every Administrator', async () => {
            const { administrators } = await adminClient.query(getAdministratorsDocument);

            expect(administrators.totalItems).toBe(8);
            expect(administrators.items.map(a => a.id)).toEqual(
                expect.arrayContaining([
                    superAdminId,
                    channelAAdminId,
                    channelBAdminId,
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
