import { CurrencyCode, DeletionResult, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
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

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
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
 * An Administrator whose Role is scoped to one Channel must not be able to update or delete
 * a Channel which that Role does not cover. See GHSA-22x4-937q-5fr5.
 *
 * This uses a dedicated environment rather than folding into channel.e2e-spec.ts, because that
 * suite deletes its second Channel and asserts fixed Channel counts across its sequential tests.
 */
describe('Channel update and delete permissions are scoped to the target Channel', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    const CHANNEL_A_TOKEN = 'channel-a-token';
    const CHANNEL_B_TOKEN = 'channel-b-token';
    // Channel C is the in-scope id paired with the out-of-scope one in the bulk deleteChannels test.
    const CHANNEL_C_TOKEN = 'channel-c-token';
    // Channel D is the Channel the scoped delete test deletes.
    const CHANNEL_D_TOKEN = 'channel-d-token';
    // Holds ReadChannel, UpdateChannel and DeleteChannel on Channels A, C and D, and no Role at all
    // on Channel B.
    const channelAAdmin = { emailAddress: 'channel-a-admin@test.com', password: 'test-password' };
    // Holds ReadChannel and UpdateChannel on both Channel A and Channel B.
    const multiChannelAdmin = { emailAddress: 'multi-channel-admin@test.com', password: 'test-password' };
    // Holds ReadChannel and UpdateChannel on Channel A, and only ReadChannel on Channel B.
    const partialPermissionAdmin = { emailAddress: 'partial-admin@test.com', password: 'test-password' };

    type ChannelFragment = FragmentOf<typeof channelFragment>;
    const channelGuard: ErrorResultGuard<ChannelFragment> = createErrorResultGuard(
        input => !!input.defaultLanguageCode,
    );

    let channelAId: string;
    let channelBId: string;
    let channelCId: string;
    let channelDId: string;

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
        roleIds: string[],
    ) {
        await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: credentials.emailAddress,
                firstName: 'Test',
                lastName: 'Admin',
                password: credentials.password,
                roleIds,
            },
        });
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

        const { createRole: channelARole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-a-admin',
                description: 'Can manage channels A, C and D',
                permissions: [Permission.ReadChannel, Permission.UpdateChannel, Permission.DeleteChannel],
                channelIds: [channelAId, channelCId, channelDId],
            },
        });
        await createTestAdministrator(channelAAdmin, [channelARole.id]);

        const { createRole: bothChannelsRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'both-channels-admin',
                description: 'Can manage channel A and channel B',
                permissions: [Permission.ReadChannel, Permission.UpdateChannel],
                channelIds: [channelAId, channelBId],
            },
        });
        await createTestAdministrator(multiChannelAdmin, [bothChannelsRole.id]);

        // A second Role which grants membership of Channel B, but not the permission to update it.
        const { createRole: channelBReadRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-b-reader',
                description: 'Can read channel B',
                permissions: [Permission.ReadChannel],
                channelIds: [channelBId],
            },
        });
        const { createRole: channelAUpdateRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-a-updater',
                description: 'Can update channel A',
                permissions: [Permission.ReadChannel, Permission.UpdateChannel],
                channelIds: [channelAId],
            },
        });
        await createTestAdministrator(partialPermissionAdmin, [channelAUpdateRole.id, channelBReadRole.id]);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it(
        'blocks updating a Channel the Role is not scoped to',
        assertThrowsWithMessage(async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            await adminClient.asUserWithCredentials(channelAAdmin.emailAddress, channelAAdmin.password);
            await adminClient.query(updateChannelDocument, {
                input: { id: channelBId, code: 'pwned-by-channel-a-admin' },
            });
        }, 'You are not currently authorized to perform this action'),
    );

    it(
        'blocks deleting a Channel the Role is not scoped to',
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
        'blocks updating a Channel the Role covers without the UpdateChannel permission',
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

    it('allows updating the Channel the Role is scoped to', async () => {
        adminClient.setChannelToken(CHANNEL_A_TOKEN);
        await adminClient.asUserWithCredentials(channelAAdmin.emailAddress, channelAAdmin.password);

        const { updateChannel } = await adminClient.query(updateChannelDocument, {
            input: { id: channelAId, code: 'channel-a-renamed' },
        });
        channelGuard.assertSuccess(updateChannel);

        expect(updateChannel.code).toBe('channel-a-renamed');
    });

    it('allows deleting the Channel the Role is scoped to', async () => {
        adminClient.setChannelToken(CHANNEL_A_TOKEN);
        await adminClient.asUserWithCredentials(channelAAdmin.emailAddress, channelAAdmin.password);

        const { deleteChannel } = await adminClient.query(deleteChannelDocument, { id: channelDId });

        expect(deleteChannel.result).toBe(DeletionResult.DELETED);

        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.asSuperAdmin();
        const { channels } = await adminClient.query(getChannelsDocument);
        expect(channels.items.find(c => c.id === channelDId)).toBeUndefined();
    });

    it('allows updating another Channel when the Role covers both', async () => {
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

    it('allows a SuperAdmin to delete any Channel', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.asSuperAdmin();

        const { deleteChannel } = await adminClient.query(deleteChannelDocument, { id: channelBId });

        expect(deleteChannel.result).toBe(DeletionResult.DELETED);
    });
});
