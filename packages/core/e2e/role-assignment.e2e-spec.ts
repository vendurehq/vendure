import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { ROLE_EDITOR_ROLE_CODE } from '@vendure/common/lib/shared-constants';
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

import { administratorFragment, channelFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql, ResultOf } from './graphql/graphql-admin';
import {
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    updateAdministratorDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/**
 * Coverage for the RoleAssignment (user, role, channel) permission model. The suite is
 * built out in a dedicated stage; see the OSS-300 stage docs for the full recorded scope
 * (resolution semantics, fail-closed guards, the roleAssignments admin API surface).
 *
 * This first slice covers the channel-isolation property and the RoleEditor creation
 * grant / replace-set revocation semantics (OSS-749).
 */
describe('RoleAssignment', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    const DEFAULT_CHANNEL_ID = 'T_1';
    type ChannelFragment = FragmentOf<typeof channelFragment>;
    const channelGuard: ErrorResultGuard<ChannelFragment> = createErrorResultGuard(
        input => !!input.defaultLanguageCode,
    );

    let secondChannel: ChannelFragment;
    let adminManagerRole: ResultOf<typeof createRoleDocument>['createRole'];
    let channelAdmin: FragmentOf<typeof administratorFragment>;
    let roleEditorRoleId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'second-channel',
                token: 'second-channel-token',
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        channelGuard.assertSuccess(createChannel);
        secondChannel = createChannel;

        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-admin-manager',
                description: '',
                permissions: [
                    Permission.CreateAdministrator,
                    Permission.ReadAdministrator,
                    Permission.UpdateAdministrator,
                    Permission.DeleteAdministrator,
                ],
            },
        });
        adminManagerRole = createRole;

        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Channel',
                lastName: 'Admin',
                emailAddress: 'channeladmin@test.com',
                password: 'test',
                roleAssignments: [{ roleId: adminManagerRole.id, channelId: secondChannel.id }],
            },
        });
        channelAdmin = createAdministrator;
        const roleEditorRole = createAdministrator.user.roles.find(r => r.code === ROLE_EDITOR_ROLE_CODE);
        if (!roleEditorRole) {
            throw new Error('Expected the created administrator to hold the RoleEditor role');
        }
        roleEditorRoleId = roleEditorRole.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // The channel-isolation property at the heart of the model: an assignment grants a
    // Role's permissions on its Channel and nothing else. Probed with createRole: the
    // creation-granted RoleEditor supplies CreateRole on second-channel only.
    it('role assignment grants permissions only on its channel', async () => {
        await adminClient.asUserWithCredentials(channelAdmin.emailAddress, 'test');
        // asUserWithCredentials switches to the user's single channel, so the
        // default-channel token must be set after logging in
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

        await assertThrowsWithMessage(async () => {
            await adminClient.query(createRoleDocument, {
                input: { code: 'not-allowed-here', description: '', permissions: [] },
            });
        }, 'You are not currently authorized to perform this action')();
    });

    it('admin can act on the channel of their assignment', async () => {
        adminClient.setChannelToken(secondChannel.token);
        await adminClient.asUserWithCredentials(channelAdmin.emailAddress, 'test');

        const { createRole } = await adminClient.query(createRoleDocument, {
            input: { code: 'created-on-second-channel', description: '', permissions: [] },
        });

        expect(createRole.code).toBe('created-on-second-channel');
    });

    // Every Administrator is granted the RoleEditor role on creation (OSS-749). The grant
    // is system-mandated: it bypasses the grant guard and lands on the channels of the
    // initial role grants, or the active channel when created without roles.
    describe('RoleEditor creation grant', () => {
        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
        });

        it('lands on the channels of the initial role assignments', async () => {
            const assignments = await getUserRoleAssignments(channelAdmin.id);

            expect(assignments.sort(byRoleCodeAndChannel)).toEqual(
                [
                    { roleCode: adminManagerRole.code, channelId: secondChannel.id },
                    { roleCode: ROLE_EDITOR_ROLE_CODE, channelId: secondChannel.id },
                ].sort(byRoleCodeAndChannel),
            );
        });

        it('is granted on the active channel when created without roles', async () => {
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'No',
                    lastName: 'Roles',
                    emailAddress: 'noroles@test.com',
                    password: 'test',
                },
            });

            const assignments = await getUserRoleAssignments(createAdministrator.id);
            expect(assignments).toEqual([
                { roleCode: ROLE_EDITOR_ROLE_CODE, channelId: DEFAULT_CHANNEL_ID },
            ]);
        });

        it('is granted on the active channel for the deprecated roleIds input', async () => {
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Role',
                    lastName: 'Ids',
                    emailAddress: 'roleids@test.com',
                    password: 'test',
                    roleIds: [adminManagerRole.id],
                },
            });

            const assignments = await getUserRoleAssignments(createAdministrator.id);
            expect(assignments.sort(byRoleCodeAndChannel)).toEqual(
                [
                    { roleCode: adminManagerRole.code, channelId: DEFAULT_CHANNEL_ID },
                    { roleCode: ROLE_EDITOR_ROLE_CODE, channelId: DEFAULT_CHANNEL_ID },
                ].sort(byRoleCodeAndChannel),
            );
        });
    });

    // RoleEditor rows are ordinary assignment rows: the replace-set writes can remove
    // them, and an update which omits RoleEditor drops it (OSS-749, sub-question 1).
    describe('replace-set revocation of RoleEditor', () => {
        it('a roleAssignments write which omits RoleEditor revokes it', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            await adminClient.query(updateAdministratorDocument, {
                input: {
                    id: channelAdmin.id,
                    roleAssignments: [{ roleId: adminManagerRole.id, channelId: secondChannel.id }],
                },
            });

            const assignments = await getUserRoleAssignments(channelAdmin.id);
            expect(assignments).toEqual([
                { roleCode: adminManagerRole.code, channelId: secondChannel.id },
            ]);

            // The revocation is effective on the next request
            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials(channelAdmin.emailAddress, 'test');
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createRoleDocument, {
                    input: { code: 'no-longer-allowed', description: '', permissions: [] },
                });
            }, 'You are not currently authorized to perform this action')();
        });

        it('setRoleAssignmentsForUser can grant RoleEditor back', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            const { setRoleAssignmentsForUser } = await adminClient.query(
                setRoleAssignmentsForUserDocument,
                {
                    userId: channelAdmin.user.id,
                    assignments: [
                        { roleId: adminManagerRole.id, channelId: secondChannel.id },
                        { roleId: roleEditorRoleId, channelId: secondChannel.id },
                    ],
                },
            );

            expect(
                setRoleAssignmentsForUser.roleAssignments
                    .map(assignment => ({
                        roleCode: assignment.role.code,
                        channelId: assignment.channelId,
                    }))
                    .sort(byRoleCodeAndChannel),
            ).toEqual(
                [
                    { roleCode: adminManagerRole.code, channelId: secondChannel.id },
                    { roleCode: ROLE_EDITOR_ROLE_CODE, channelId: secondChannel.id },
                ].sort(byRoleCodeAndChannel),
            );

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials(channelAdmin.emailAddress, 'test');
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: { code: 'allowed-once-again', description: '', permissions: [] },
            });
            expect(createRole.code).toBe('allowed-once-again');
        });

        // The recorded trap: a legacy client updating an administrator's roles via the
        // deprecated roleIds input silently strips RoleEditor on the active channel.
        it('the deprecated roleIds input silently strips RoleEditor on the active channel', async () => {
            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asSuperAdmin();
            await adminClient.query(updateAdministratorDocument, {
                input: {
                    id: channelAdmin.id,
                    roleIds: [adminManagerRole.id],
                },
            });

            const assignments = await getUserRoleAssignments(channelAdmin.id);
            expect(assignments).toEqual([
                { roleCode: adminManagerRole.code, channelId: secondChannel.id },
            ]);
        });
    });

    function byRoleCodeAndChannel(
        a: { roleCode: string; channelId: string },
        b: { roleCode: string; channelId: string },
    ) {
        return a.roleCode.localeCompare(b.roleCode) || a.channelId.localeCompare(b.channelId);
    }

    async function getUserRoleAssignments(
        administratorId: string,
    ): Promise<Array<{ roleCode: string; channelId: string }>> {
        const { administrator } = await adminClient.query(administratorRoleAssignmentsDocument, {
            id: administratorId,
        });
        return (administrator?.user.roleAssignments ?? []).map(assignment => ({
            roleCode: assignment.role.code,
            channelId: assignment.channelId,
        }));
    }
});

const administratorRoleAssignmentsDocument = graphql(`
    query AdministratorRoleAssignments($id: ID!) {
        administrator(id: $id) {
            id
            user {
                id
                roleAssignments {
                    role {
                        code
                    }
                    channelId
                }
            }
        }
    }
`);

const setRoleAssignmentsForUserDocument = graphql(`
    mutation SetRoleAssignmentsForUser($userId: ID!, $assignments: [RoleAssignmentInput!]!) {
        setRoleAssignmentsForUser(userId: $userId, assignments: $assignments) {
            id
            roleAssignments {
                role {
                    code
                }
                channelId
            }
        }
    }
`);
