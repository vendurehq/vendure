import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { ROLE_EDITOR_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import { AdministratorEvent, EventBus, RoleAssignmentEvent, VendureEvent } from '@vendure/core';
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

    // OSS-751 — the role-change event contract of the assignment model. RoleAssignmentEvent
    // (channel-scoped, keyed on the User) is emitted by every actor-made assignment write and
    // is the only role-change event: the legacy RoleChangeEvent was removed in v4.0.0.
    // AdministratorEvent fires as before. System-mandated rows (the RoleEditor creation grant,
    // the SuperAdmin rows materialized on Channel creation) are not reported, as in the
    // legacy model.
    describe('event contract', () => {
        interface RecordedEvent {
            kind: 'RoleAssignmentEvent' | 'AdministratorEvent';
            type: string;
            userId: string;
            assignments?: Array<{ roleId: string; channelId: string }>;
        }
        const recorded: RecordedEvent[] = [];
        let subscription: Subscription;
        let roleA: ResultOf<typeof createRoleDocument>['createRole'];
        let roleB: ResultOf<typeof createRoleDocument>['createRole'];
        let eventAdmin: FragmentOf<typeof administratorFragment>;
        let legacyAdmin: FragmentOf<typeof administratorFragment>;

        const toApiId = (id: ID) => `T_${id}`;
        const kindsOf = (events: RecordedEvent[]) => events.map(e => `${e.kind}:${e.type}`);
        const byRoleAndChannel = (
            a: { roleId: string; channelId: string },
            b: { roleId: string; channelId: string },
        ) => a.roleId.localeCompare(b.roleId) || a.channelId.localeCompare(b.channelId);

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            subscription = server.app
                .get(EventBus)
                .filter<VendureEvent>(e => e instanceof RoleAssignmentEvent || e instanceof AdministratorEvent)
                .subscribe(event => {
                    if (event instanceof RoleAssignmentEvent) {
                        recorded.push({
                            kind: 'RoleAssignmentEvent',
                            type: event.type,
                            userId: toApiId(event.user.id),
                            assignments: event.assignments.map(a => ({
                                roleId: toApiId(a.roleId),
                                channelId: toApiId(a.channelId),
                            })),
                        });
                    } else if (event instanceof AdministratorEvent) {
                        recorded.push({
                            kind: 'AdministratorEvent',
                            type: event.type,
                            userId: toApiId(event.entity.user.id),
                        });
                    }
                });
            const { createRole: createdA } = await adminClient.query(createRoleDocument, {
                input: { code: 'event-role-a', description: '', permissions: [] },
            });
            roleA = createdA;
            const { createRole: createdB } = await adminClient.query(createRoleDocument, {
                input: { code: 'event-role-b', description: '', permissions: [] },
            });
            roleB = createdB;
            recorded.length = 0;
        });

        afterAll(() => {
            subscription.unsubscribe();
        });

        // Subscribers are notified once the mutation's transaction has committed, which can be
        // after the HTTP response has arrived, so wait until the stream has gone quiet.
        async function collectEvents(): Promise<RecordedEvent[]> {
            let previousLength: number;
            do {
                previousLength = recorded.length;
                await new Promise(resolve => setTimeout(resolve, 100));
            } while (recorded.length !== previousLength);
            const events = recorded.slice();
            recorded.length = 0;
            return events;
        }

        it('createAdministrator with roleAssignments emits RoleAssignmentEvent, then AdministratorEvent created', async () => {
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Event',
                    lastName: 'Admin',
                    emailAddress: 'event-admin@test.com',
                    password: 'test',
                    roleAssignments: [
                        { roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID },
                        { roleId: roleA.id, channelId: secondChannel.id },
                    ],
                },
            });
            eventAdmin = createAdministrator;

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['RoleAssignmentEvent:assigned', 'AdministratorEvent:created']);
            const [assigned] = events;
            expect(assigned.userId).toBe(eventAdmin.user.id);
            // the system-mandated RoleEditor grant is not reported
            expect(assigned.assignments?.sort(byRoleAndChannel)).toEqual(
                [
                    { roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID },
                    { roleId: roleA.id, channelId: secondChannel.id },
                ].sort(byRoleAndChannel),
            );
        });

        it('createAdministrator with the deprecated roleIds input emits RoleAssignmentEvent on the active channel', async () => {
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Legacy',
                    lastName: 'Admin',
                    emailAddress: 'legacy-event-admin@test.com',
                    password: 'test',
                    roleIds: [roleA.id],
                },
            });
            legacyAdmin = createAdministrator;

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['RoleAssignmentEvent:assigned', 'AdministratorEvent:created']);
            expect(events[0].assignments).toEqual([{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }]);
        });

        it('a channel-only move emits RoleAssignmentEvent for the removed and the added pair', async () => {
            // legacyAdmin holds role-a and RoleEditor on the default channel; move role-a to
            // the second channel.
            await adminClient.query(updateAdministratorDocument, {
                input: {
                    id: legacyAdmin.id,
                    roleAssignments: [
                        { roleId: roleA.id, channelId: secondChannel.id },
                        { roleId: roleEditorRoleId, channelId: DEFAULT_CHANNEL_ID },
                    ],
                },
            });

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual([
                'RoleAssignmentEvent:assigned',
                'RoleAssignmentEvent:removed',
                'AdministratorEvent:updated',
            ]);
            expect(events[0].assignments).toEqual([{ roleId: roleA.id, channelId: secondChannel.id }]);
            expect(events[1].assignments).toEqual([{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }]);
        });

        it('the deprecated roleIds input reports only the pairs changed on the active channel', async () => {
            // eventAdmin holds role-a and RoleEditor on both channels. Replacing the default
            // channel's roles with role-b revokes role-a and RoleEditor there; the second
            // channel's rows are untouched and must not be reported.
            await adminClient.query(updateAdministratorDocument, {
                input: { id: eventAdmin.id, roleIds: [roleB.id] },
            });

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual([
                'RoleAssignmentEvent:assigned',
                'RoleAssignmentEvent:removed',
                'AdministratorEvent:updated',
            ]);
            expect(events[0].assignments).toEqual([{ roleId: roleB.id, channelId: DEFAULT_CHANNEL_ID }]);
            expect(events[1].assignments?.sort(byRoleAndChannel)).toEqual(
                [
                    { roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID },
                    { roleId: roleEditorRoleId, channelId: DEFAULT_CHANNEL_ID },
                ].sort(byRoleAndChannel),
            );
            expect(events[0].userId).toBe(eventAdmin.user.id);

            const assignments = await getUserRoleAssignments(eventAdmin.id);
            expect(assignments).toContainEqual({ roleCode: roleA.code, channelId: secondChannel.id });
        });

        it('a no-op roleIds update emits only AdministratorEvent updated', async () => {
            await adminClient.query(updateAdministratorDocument, {
                input: { id: eventAdmin.id, roleIds: [roleB.id] },
            });

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['AdministratorEvent:updated']);
        });

        it('setRoleAssignmentsForUser emits RoleAssignmentEvent but no AdministratorEvent', async () => {
            // drop role-b, the only role held on the default channel
            await adminClient.query(setRoleAssignmentsForUserDocument, {
                userId: eventAdmin.user.id,
                assignments: [
                    { roleId: roleA.id, channelId: secondChannel.id },
                    { roleId: roleEditorRoleId, channelId: secondChannel.id },
                ],
            });

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['RoleAssignmentEvent:removed']);
            expect(events[0].assignments).toEqual([{ roleId: roleB.id, channelId: DEFAULT_CHANNEL_ID }]);
        });

        it('createApiKey emits RoleAssignmentEvent keyed on the API-key user', async () => {
            await adminClient.query(createApiKeyDocument, {
                input: {
                    roleAssignments: [{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }],
                    translations: [{ languageCode: LanguageCode.en, name: 'Event API Key' }],
                },
            });

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['RoleAssignmentEvent:assigned']);
            expect(events[0].userId).not.toBe(eventAdmin.user.id);
            expect(events[0].userId).not.toBe(legacyAdmin.user.id);
            expect(events[0].assignments).toEqual([{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }]);
        });

        it('the SuperAdmin rows materialized on channel creation are not reported', async () => {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'event-channel',
                    token: 'event-channel-token',
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            channelGuard.assertSuccess(createChannel);

            const events = await collectEvents();
            expect(events).toEqual([]);
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

const createApiKeyDocument = graphql(`
    mutation CreateApiKeyForEventContract($input: CreateApiKeyInput!) {
        createApiKey(input: $input) {
            apiKey
            entityId
        }
    }
`);
