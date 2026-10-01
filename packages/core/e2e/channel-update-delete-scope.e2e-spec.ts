import { CurrencyCode, DeletionResult, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { EventBus, RoleAssignmentEvent } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import path from 'path';
import { Subscription } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql } from './graphql/graphql-admin';
import {
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    deleteChannelDocument,
    deleteChannelsDocument,
    getChannelsDocument,
    updateChannelDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/**
 * An Administrator whose RoleAssignments are on one Channel must not be able to update or delete
 * a Channel on which they hold no assignment granting that permission. See GHSA-22x4-937q-5fr5.
 *
 * This uses a dedicated environment rather than folding into channel.e2e-spec.ts, because that
 * suite deletes its second Channel and asserts fixed Channel counts across its sequential tests.
 */
// GHSA-22x4-937q-5fr5 — ChannelService.update/delete check the permission on the target Channel.
describe('Channel update and delete permissions are scoped to the target Channel', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    const CHANNEL_A_TOKEN = 'channel-a-token';
    const CHANNEL_B_TOKEN = 'channel-b-token';
    // Channel C is the in-scope id paired with the out-of-scope one in the bulk deleteChannels test.
    const CHANNEL_C_TOKEN = 'channel-c-token';
    // Channel D is the Channel the scoped delete test deletes.
    const CHANNEL_D_TOKEN = 'channel-d-token';
    // Holds the channel-manager Role (ReadChannel, UpdateChannel, DeleteChannel) on Channels A, C
    // and D, and no assignment at all on Channel B.
    const channelAAdmin = { emailAddress: 'channel-a-admin@test.com', password: 'test-password' };
    // Holds the channel-updater Role (ReadChannel, UpdateChannel) on both Channel A and Channel B.
    const multiChannelAdmin = { emailAddress: 'multi-channel-admin@test.com', password: 'test-password' };
    // Holds the channel-updater Role on Channel A, and only the channel-reader Role on Channel B.
    const partialPermissionAdmin = { emailAddress: 'partial-admin@test.com', password: 'test-password' };

    type ChannelFragment = FragmentOf<typeof channelFragment>;
    const channelGuard: ErrorResultGuard<ChannelFragment> = createErrorResultGuard(
        input => !!input.defaultLanguageCode,
    );

    let channelAId: string;
    let channelBId: string;
    let channelCId: string;
    let channelDId: string;
    let multiChannelAdminUserId: string;
    let channelUpdaterRoleId: string;

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
        credentials: { emailAddress: string; password: string },
        roleAssignments: Array<{ roleId: string; channelId: string }>,
    ) {
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: credentials.emailAddress,
                firstName: 'Test',
                lastName: 'Admin',
                password: credentials.password,
                roleAssignments,
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

        channelAId = await createTestChannel('channel-a', CHANNEL_A_TOKEN);
        channelBId = await createTestChannel('channel-b', CHANNEL_B_TOKEN);
        channelCId = await createTestChannel('channel-c', CHANNEL_C_TOKEN);
        channelDId = await createTestChannel('channel-d', CHANNEL_D_TOKEN);

        const { createRole: channelManagerRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-manager',
                description: 'Can read, update and delete channels',
                permissions: [Permission.ReadChannel, Permission.UpdateChannel, Permission.DeleteChannel],
            },
        });
        const { createRole: channelUpdaterRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-updater',
                description: 'Can read and update channels',
                permissions: [Permission.ReadChannel, Permission.UpdateChannel],
            },
        });
        // Grants membership of a Channel, but not the permission to update it.
        const { createRole: channelReaderRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-reader',
                description: 'Can read channels',
                permissions: [Permission.ReadChannel],
            },
        });
        channelUpdaterRoleId = channelUpdaterRole.id;

        await createTestAdministrator(
            channelAAdmin,
            [channelAId, channelCId, channelDId].map(channelId => ({
                roleId: channelManagerRole.id,
                channelId,
            })),
        );
        const multiChannel = await createTestAdministrator(multiChannelAdmin, [
            { roleId: channelUpdaterRole.id, channelId: channelAId },
            { roleId: channelUpdaterRole.id, channelId: channelBId },
        ]);
        multiChannelAdminUserId = multiChannel.user.id;
        await createTestAdministrator(partialPermissionAdmin, [
            { roleId: channelUpdaterRole.id, channelId: channelAId },
            { roleId: channelReaderRole.id, channelId: channelBId },
        ]);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it(
        'blocks updating a Channel the actor holds no assignment on',
        assertThrowsWithMessage(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asUserWithCredentials(channelAAdmin.emailAddress, channelAAdmin.password);
            await adminClient.query(updateChannelDocument, {
                input: { id: channelBId, code: 'pwned-by-channel-a-admin' },
            });
        }, 'You are not currently authorized to perform this action'),
    );

    it(
        'blocks deleting a Channel the actor holds no assignment on',
        assertThrowsWithMessage(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asUserWithCredentials(channelAAdmin.emailAddress, channelAAdmin.password);
            await adminClient.query(deleteChannelDocument, { id: channelBId });
        }, 'You are not currently authorized to perform this action'),
    );

    // The in-scope id is Channel C rather than Channel A, so that the later tests on Channel A do not
    // depend on what this call does to the in-scope id. The test asserts only the security property:
    // the out-of-scope Channel B is untouched.
    it(
        'blocks the bulk deleteChannels mutation when one id is out of scope',
        assertThrowsWithMessage(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asUserWithCredentials(channelAAdmin.emailAddress, channelAAdmin.password);
            await adminClient.query(deleteChannelsDocument, { ids: [channelCId, channelBId] });
        }, 'You are not currently authorized to perform this action'),
    );

    it(
        'blocks updating a Channel whose assignment lacks the UpdateChannel permission',
        assertThrowsWithMessage(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asUserWithCredentials(
                partialPermissionAdmin.emailAddress,
                partialPermissionAdmin.password,
            );
            await adminClient.query(updateChannelDocument, {
                input: { id: channelBId, code: 'pwned-by-reader' },
            });
        }, 'You are not currently authorized to perform this action'),
    );

    it('leaves both Channels intact after the blocked attempts', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.asSuperAdmin();

        const { channels } = await adminClient.query(getChannelsDocument);

        expect(channels.items.find(c => c.id === channelAId)?.code).toBe('channel-a');
        expect(channels.items.find(c => c.id === channelBId)?.code).toBe('channel-b');
    });

    it('allows updating a Channel the actor holds UpdateChannel on', async () => {
        adminClient.setChannelToken(CHANNEL_A_TOKEN);
        await adminClient.asUserWithCredentials(channelAAdmin.emailAddress, channelAAdmin.password);

        const { updateChannel } = await adminClient.query(updateChannelDocument, {
            input: { id: channelAId, code: 'channel-a-renamed' },
        });
        channelGuard.assertSuccess(updateChannel);

        expect(updateChannel.code).toBe('channel-a-renamed');
    });

    it('allows deleting a Channel the actor holds DeleteChannel on', async () => {
        adminClient.setChannelToken(CHANNEL_A_TOKEN);
        await adminClient.asUserWithCredentials(channelAAdmin.emailAddress, channelAAdmin.password);

        const { deleteChannel } = await adminClient.query(deleteChannelDocument, { id: channelDId });

        expect(deleteChannel.result).toBe(DeletionResult.DELETED);

        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.asSuperAdmin();
        const { channels } = await adminClient.query(getChannelsDocument);
        expect(channels.items.find(c => c.id === channelDId)).toBeUndefined();
    });

    it('allows updating another Channel when the Role is assigned on both', async () => {
        adminClient.setChannelToken(CHANNEL_A_TOKEN);
        await adminClient.asUserWithCredentials(multiChannelAdmin.emailAddress, multiChannelAdmin.password);

        const { updateChannel } = await adminClient.query(updateChannelDocument, {
            input: { id: channelBId, code: 'channel-b-by-multi-channel-admin' },
        });
        channelGuard.assertSuccess(updateChannel);

        expect(updateChannel.code).toBe('channel-b-by-multi-channel-admin');
    });

    it('allows a SuperAdmin to update any Channel', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.asSuperAdmin();

        const { updateChannel } = await adminClient.query(updateChannelDocument, {
            input: { id: channelBId, code: 'channel-b-renamed' },
        });
        channelGuard.assertSuccess(updateChannel);

        expect(updateChannel.code).toBe('channel-b-renamed');
    });

    // GHSA-22x4-937q-5fr5 — deleting a Channel removes its RoleAssignment rows through
    // RoleAssignmentService, so a `removed` RoleAssignmentEvent is published for each affected
    // User rather than the rows silently cascading away with the Channel.
    describe('SuperAdmin deleting a Channel with RoleAssignments on it', () => {
        const toApiId = (id: ID) => `T_${id}`;
        const removedEvents: Array<{
            userId: string;
            assignments: Array<{ roleId: string; channelId: string }>;
        }> = [];
        let subscription: Subscription;

        beforeAll(() => {
            subscription = server.app
                .get(EventBus)
                .ofType(RoleAssignmentEvent)
                .subscribe(event => {
                    if (event.type === 'removed') {
                        removedEvents.push({
                            userId: toApiId(event.user.id),
                            assignments: event.assignments.map(a => ({
                                roleId: toApiId(a.roleId),
                                channelId: toApiId(a.channelId),
                            })),
                        });
                    }
                });
        });

        afterAll(() => {
            subscription.unsubscribe();
        });

        it('allows a SuperAdmin to delete any Channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();

            const { deleteChannel } = await adminClient.query(deleteChannelDocument, { id: channelBId });

            expect(deleteChannel.result).toBe(DeletionResult.DELETED);
        });

        it('removes the assignment on the deleted Channel and keeps the one on the other Channel', async () => {
            const { roleAssignments } = await adminClient.query(roleAssignmentsOfUserDocument, {
                userId: multiChannelAdminUserId,
            });

            expect(roleAssignments.items).toEqual([{ roleId: channelUpdaterRoleId, channelId: channelAId }]);
        });

        it('publishes a removed RoleAssignmentEvent listing the deleted Channel assignment', async () => {
            // Subscribers are notified once the transaction has committed, which can be after the
            // HTTP response has arrived.
            await expect
                .poll(() => removedEvents.filter(e => e.userId === multiChannelAdminUserId))
                .toEqual([
                    {
                        userId: multiChannelAdminUserId,
                        assignments: [{ roleId: channelUpdaterRoleId, channelId: channelBId }],
                    },
                ]);
        });
    });
});

const roleAssignmentsOfUserDocument = graphql(`
    query ChannelScopeRoleAssignmentsOfUser($userId: String!) {
        roleAssignments(options: { filter: { userId: { eq: $userId } } }) {
            items {
                roleId
                channelId
            }
        }
    }
`);
