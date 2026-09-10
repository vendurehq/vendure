import { CurrencyCode, DeletionResult, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { ROLE_EDITOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
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
    assignRolesToUserDocument,
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    deleteAdministratorDocument,
    getActiveAdministratorDocument,
    removeRolesFromUserDocument,
    updateAdministratorDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/**
 * Coverage for the RoleAssignment (user, role, channel) permission model: the
 * channel-isolation property, the assign / remove mutations and their single grant rule
 * (RoleService.canGrant: the actor holds every permission of the Role on that Channel),
 * the filtered assignment reads, the SuperAdmin expansion, and the event contract.
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
    let superAdminRoleId: string;

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

        const { roles } = await adminClient.query(rolesDocument);
        const roleEditorRole = roles.items.find(r => r.code === ROLE_EDITOR_ROLE_CODE);
        const superAdminRole = roles.items.find(r => r.code === SUPER_ADMIN_ROLE_CODE);
        if (!roleEditorRole || !superAdminRole) {
            throw new Error('Expected the RoleEditor and SuperAdmin system roles to exist');
        }
        roleEditorRoleId = roleEditorRole.id;
        superAdminRoleId = superAdminRole.id;

        // RoleEditor is an explicit grant: the channel admin receives it on second-channel
        // alongside the admin-manager role.
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Channel',
                lastName: 'Admin',
                emailAddress: 'channeladmin@test.com',
                password: 'test',
                roleAssignments: [
                    { roleId: adminManagerRole.id, channelId: secondChannel.id },
                    { roleId: roleEditorRoleId, channelId: secondChannel.id },
                ],
            },
        });
        channelAdmin = createAdministrator;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function asSuperAdminOnDefaultChannel() {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.asSuperAdmin();
    }

    async function asChannelAdminOnSecondChannel() {
        adminClient.setChannelToken(secondChannel.token);
        await adminClient.asUserWithCredentials(channelAdmin.emailAddress, 'test');
    }

    // The channel-isolation property at the heart of the model: an assignment grants a
    // Role's permissions on its Channel and nothing else. Probed with createRole: the
    // RoleEditor grant supplies CreateRole on second-channel only.
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
        await asChannelAdminOnSecondChannel();

        const { createRole } = await adminClient.query(createRoleDocument, {
            input: { code: 'created-on-second-channel', description: '', permissions: [] },
        });

        expect(createRole.code).toBe('created-on-second-channel');
    });

    // RoleEditor is an ordinary Role granted explicitly (OSS-749): creating an
    // Administrator stores exactly the given assignments and nothing else.
    describe('RoleEditor is an explicit grant', () => {
        beforeAll(async () => {
            await asSuperAdminOnDefaultChannel();
        });

        it('createAdministrator stores exactly the given assignments', async () => {
            const assignments = await getUserRoleAssignments(channelAdmin.id);

            expect(assignments.sort(byRoleCodeAndChannel)).toEqual(
                [
                    { roleCode: adminManagerRole.code, channelId: secondChannel.id },
                    { roleCode: ROLE_EDITOR_ROLE_CODE, channelId: secondChannel.id },
                ].sort(byRoleCodeAndChannel),
            );
        });

        it('an administrator created without roles holds no assignments', async () => {
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'No',
                    lastName: 'Roles',
                    emailAddress: 'noroles@test.com',
                    password: 'test',
                },
            });

            const assignments = await getUserRoleAssignments(createAdministrator.id);
            expect(assignments).toEqual([]);
        });

        it('the deprecated roleIds input grants only the given Roles on the active channel', async () => {
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
            expect(assignments).toEqual([
                { roleCode: adminManagerRole.code, channelId: DEFAULT_CHANNEL_ID },
            ]);
        });
    });

    // assignRolesToUser / removeRolesFromUser are deltas: each pair is granted or revoked on
    // its own, existing pairs on assign and missing pairs on remove are no-ops, and a
    // revocation takes effect on the User's next request.
    describe('assign and remove', () => {
        beforeAll(async () => {
            await asSuperAdminOnDefaultChannel();
        });

        it('removeRolesFromUser revokes RoleEditor', async () => {
            const { removeRolesFromUser } = await adminClient.query(removeRolesFromUserDocument, {
                input: {
                    userId: channelAdmin.user.id,
                    assignments: [{ roleId: roleEditorRoleId, channelId: secondChannel.id }],
                },
            });

            expect(toRoleCodeAndChannel(removeRolesFromUser.roleAssignments)).toEqual([
                { roleCode: adminManagerRole.code, channelId: secondChannel.id },
            ]);

            // The revocation is effective on the next request
            await asChannelAdminOnSecondChannel();
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createRoleDocument, {
                    input: { code: 'no-longer-allowed', description: '', permissions: [] },
                });
            }, 'You are not currently authorized to perform this action')();
        });

        it('assignRolesToUser grants RoleEditor back', async () => {
            await asSuperAdminOnDefaultChannel();
            const { assignRolesToUser } = await adminClient.query(assignRolesToUserDocument, {
                input: {
                    userId: channelAdmin.user.id,
                    assignments: [{ roleId: roleEditorRoleId, channelId: secondChannel.id }],
                },
            });

            expect(toRoleCodeAndChannel(assignRolesToUser.roleAssignments).sort(byRoleCodeAndChannel)).toEqual(
                [
                    { roleCode: adminManagerRole.code, channelId: secondChannel.id },
                    { roleCode: ROLE_EDITOR_ROLE_CODE, channelId: secondChannel.id },
                ].sort(byRoleCodeAndChannel),
            );

            await asChannelAdminOnSecondChannel();
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: { code: 'allowed-once-again', description: '', permissions: [] },
            });
            expect(createRole.code).toBe('allowed-once-again');
        });

        it('assigning a pair the user already holds is a no-op', async () => {
            await asSuperAdminOnDefaultChannel();
            const { assignRolesToUser } = await adminClient.query(assignRolesToUserDocument, {
                input: {
                    userId: channelAdmin.user.id,
                    assignments: [{ roleId: adminManagerRole.id, channelId: secondChannel.id }],
                },
            });

            expect(toRoleCodeAndChannel(assignRolesToUser.roleAssignments).sort(byRoleCodeAndChannel)).toEqual(
                [
                    { roleCode: adminManagerRole.code, channelId: secondChannel.id },
                    { roleCode: ROLE_EDITOR_ROLE_CODE, channelId: secondChannel.id },
                ].sort(byRoleCodeAndChannel),
            );
        });

        it('removing a pair the user does not hold is a no-op', async () => {
            const { removeRolesFromUser } = await adminClient.query(removeRolesFromUserDocument, {
                input: {
                    userId: channelAdmin.user.id,
                    assignments: [{ roleId: adminManagerRole.id, channelId: DEFAULT_CHANNEL_ID }],
                },
            });

            expect(toRoleCodeAndChannel(removeRolesFromUser.roleAssignments).sort(byRoleCodeAndChannel)).toEqual(
                [
                    { roleCode: adminManagerRole.code, channelId: secondChannel.id },
                    { roleCode: ROLE_EDITOR_ROLE_CODE, channelId: secondChannel.id },
                ].sort(byRoleCodeAndChannel),
            );
        });

        it(
            'assigning an unknown Role fails',
            assertThrowsWithMessage(async () => {
                await adminClient.query(assignRolesToUserDocument, {
                    input: {
                        userId: channelAdmin.user.id,
                        assignments: [{ roleId: 'T_999', channelId: secondChannel.id }],
                    },
                });
            }, 'No Role with the id "999" could be found'),
        );

        it(
            'assigning on an unknown Channel fails',
            assertThrowsWithMessage(async () => {
                await adminClient.query(assignRolesToUserDocument, {
                    input: {
                        userId: channelAdmin.user.id,
                        assignments: [{ roleId: adminManagerRole.id, channelId: 'T_999' }],
                    },
                });
            }, 'No Channel with the id "999" could be found'),
        );

        // The deprecated roleIds input is a replace-set on the active channel, applied as
        // deltas: a legacy client updating an administrator's roles through it silently
        // strips RoleEditor there.
        it('the deprecated roleIds input replaces the Roles on the active channel', async () => {
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

            // restore RoleEditor for the suites below
            await asSuperAdminOnDefaultChannel();
            await adminClient.query(assignRolesToUserDocument, {
                input: {
                    userId: channelAdmin.user.id,
                    assignments: [{ roleId: roleEditorRoleId, channelId: secondChannel.id }],
                },
            });
        });
    });

    // The SuperAdmin Role has no channel scope: the RolePermissionResolver grants all
    // permissions on every Channel from a single row, so the stored rows are kept in step
    // with that access.
    describe('SuperAdmin expansion', () => {
        let secondSuperAdmin: FragmentOf<typeof administratorFragment>;

        beforeAll(async () => {
            await asSuperAdminOnDefaultChannel();
        });

        it('granting SuperAdmin on one channel grants it on every channel', async () => {
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Second',
                    lastName: 'SuperAdmin',
                    emailAddress: 'superadmin2@test.com',
                    password: 'test',
                    roleAssignments: [{ roleId: superAdminRoleId, channelId: secondChannel.id }],
                },
            });
            secondSuperAdmin = createAdministrator;

            const assignments = await getUserRoleAssignments(secondSuperAdmin.id);
            expect(assignments.sort(byRoleCodeAndChannel)).toEqual(
                [
                    { roleCode: SUPER_ADMIN_ROLE_CODE, channelId: DEFAULT_CHANNEL_ID },
                    { roleCode: SUPER_ADMIN_ROLE_CODE, channelId: secondChannel.id },
                ].sort(byRoleCodeAndChannel),
            );
        });

        it('a non-SuperAdmin cannot grant the SuperAdmin role', async () => {
            await asChannelAdminOnSecondChannel();
            await assertThrowsWithMessage(async () => {
                await adminClient.query(assignRolesToUserDocument, {
                    input: {
                        userId: channelAdmin.user.id,
                        assignments: [{ roleId: superAdminRoleId, channelId: secondChannel.id }],
                    },
                });
            }, 'Active user does not have sufficient permissions')();
        });

        it('removing SuperAdmin on one channel removes it on every channel', async () => {
            await asSuperAdminOnDefaultChannel();
            const { removeRolesFromUser } = await adminClient.query(removeRolesFromUserDocument, {
                input: {
                    userId: secondSuperAdmin.user.id,
                    assignments: [{ roleId: superAdminRoleId, channelId: secondChannel.id }],
                },
            });

            expect(removeRolesFromUser.roleAssignments).toEqual([]);
        });

        it('the sole SuperAdmin cannot lose the SuperAdmin role', async () => {
            const { activeAdministrator } = await adminClient.query(getActiveAdministratorDocument);
            if (!activeAdministrator) {
                throw new Error('Expected the SuperAdmin to be logged in');
            }
            await assertThrowsWithMessage(async () => {
                await adminClient.query(removeRolesFromUserDocument, {
                    input: {
                        userId: activeAdministrator.user.id,
                        assignments: [{ roleId: superAdminRoleId, channelId: DEFAULT_CHANNEL_ID }],
                    },
                });
            }, 'Cannot remove the SuperAdmin role from the sole SuperAdmin')();
        });
    });

    // One rule for reads and writes: an assignment is visible to an actor iff they may grant
    // it, and they may grant it iff they hold every permission of its Role on its Channel.
    describe('grant rule', () => {
        let hiddenRole: ResultOf<typeof createRoleDocument>['createRole'];
        let defaultChannelManager: FragmentOf<typeof administratorFragment>;
        // The user whose assignments the actors read and write
        let subject: FragmentOf<typeof administratorFragment>;

        beforeAll(async () => {
            await asSuperAdminOnDefaultChannel();
            // A Role whose permission list neither channel-scoped actor holds anywhere
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: { code: 'order-reader', description: '', permissions: [Permission.ReadOrder] },
            });
            hiddenRole = createRole;
            // An actor holding the admin-manager permissions on the default channel only
            const { createAdministrator: manager } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Default',
                    lastName: 'Manager',
                    emailAddress: 'defaultmanager@test.com',
                    password: 'test',
                    roleAssignments: [{ roleId: adminManagerRole.id, channelId: DEFAULT_CHANNEL_ID }],
                },
            });
            defaultChannelManager = manager;
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Grant',
                    lastName: 'Subject',
                    emailAddress: 'subject@test.com',
                    password: 'test',
                    roleAssignments: [
                        { roleId: adminManagerRole.id, channelId: secondChannel.id },
                        { roleId: hiddenRole.id, channelId: secondChannel.id },
                    ],
                },
            });
            subject = createAdministrator;
        });

        it('User.roleAssignments is filtered to what the actor may grant', async () => {
            await asChannelAdminOnSecondChannel();
            const assignments = await getUserRoleAssignments(subject.id);

            expect(assignments).toEqual([{ roleCode: adminManagerRole.code, channelId: secondChannel.id }]);
        });

        it('the roleAssignments list is filtered and counts only visible assignments', async () => {
            const { roleAssignments } = await adminClient.query(roleAssignmentsOfUserDocument, {
                userId: subject.user.id,
            });

            expect(roleAssignments.totalItems).toBe(1);
            expect(roleAssignments.items.map(a => a.role.code)).toEqual([adminManagerRole.code]);

            const { roleAssignments: all } = await adminClient.query(allRoleAssignmentsDocument);
            const visibleRoleCodes = all.items.map(a => a.role.code);
            expect(visibleRoleCodes).not.toContain(SUPER_ADMIN_ROLE_CODE);
            expect(visibleRoleCodes).not.toContain(hiddenRole.code);
            expect(all.items.every(a => a.channelId === secondChannel.id)).toBe(true);
            expect(all.totalItems).toBe(all.items.length);
        });

        it('the SuperAdmin sees every assignment', async () => {
            await asSuperAdminOnDefaultChannel();
            const assignments = await getUserRoleAssignments(subject.id);

            expect(assignments.sort(byRoleCodeAndChannel)).toEqual(
                [
                    { roleCode: adminManagerRole.code, channelId: secondChannel.id },
                    { roleCode: hiddenRole.code, channelId: secondChannel.id },
                ].sort(byRoleCodeAndChannel),
            );
        });

        it('a hidden assignment cannot be removed', async () => {
            await asChannelAdminOnSecondChannel();
            await assertThrowsWithMessage(async () => {
                await adminClient.query(removeRolesFromUserDocument, {
                    input: {
                        userId: subject.user.id,
                        assignments: [{ roleId: hiddenRole.id, channelId: secondChannel.id }],
                    },
                });
            }, 'Active user does not have sufficient permissions')();
        });

        // The deprecated roleIds replace-set fails closed: omitting a pair the actor cannot
        // see would revoke it, so the update is refused as a whole.
        it('the deprecated roleIds input fails when it omits a pair the actor cannot see', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(updateAdministratorDocument, {
                    input: { id: subject.id, roleIds: [adminManagerRole.id] },
                });
            }, 'Active user does not have sufficient permissions')();

            await asSuperAdminOnDefaultChannel();
            const assignments = await getUserRoleAssignments(subject.id);
            expect(assignments).toHaveLength(2);
        });

        // The invariant behind the whole design, checked over a matrix of actors × roles ×
        // channels rather than per scenario: a pair is in the actor's filtered read iff the
        // actor's assignRolesToUser of that pair is accepted. The subject holds every pair of
        // the matrix beforehand, so an accepted assign is a no-op and the matrix stays put.
        it('a pair is visible to an actor iff the actor may assign it', async () => {
            await asSuperAdminOnDefaultChannel();
            const roleIds = [adminManagerRole.id, roleEditorRoleId, hiddenRole.id, superAdminRoleId];
            const channelIds = [DEFAULT_CHANNEL_ID, secondChannel.id];
            const matrix = roleIds.flatMap(roleId => channelIds.map(channelId => ({ roleId, channelId })));
            await adminClient.query(assignRolesToUserDocument, {
                input: { userId: subject.user.id, assignments: matrix },
            });

            const actors = [
                { emailAddress: channelAdmin.emailAddress, channelToken: secondChannel.token },
                { emailAddress: defaultChannelManager.emailAddress, channelToken: E2E_DEFAULT_CHANNEL_TOKEN },
            ];
            const outcomes: Array<{ actor: string; pair: string; visible: boolean; accepted: boolean }> = [];
            for (const actor of actors) {
                adminClient.setChannelToken(actor.channelToken);
                await adminClient.asUserWithCredentials(actor.emailAddress, 'test');
                const { roleAssignments } = await adminClient.query(roleAssignmentsOfUserDocument, {
                    userId: subject.user.id,
                });
                const visiblePairs = roleAssignments.items.map(a => `${a.roleId}|${a.channelId}`);
                for (const pair of matrix) {
                    const accepted = await adminClient
                        .query(assignRolesToUserDocument, {
                            input: { userId: subject.user.id, assignments: [pair] },
                        })
                        .then(
                            () => true,
                            () => false,
                        );
                    outcomes.push({
                        actor: actor.emailAddress,
                        pair: `${pair.roleId}|${pair.channelId}`,
                        visible: visiblePairs.includes(`${pair.roleId}|${pair.channelId}`),
                        accepted,
                    });
                }
            }

            const drift = outcomes.filter(o => o.visible !== o.accepted);
            expect(drift).toEqual([]);
            // Sanity: the matrix exercises both outcomes for both actors
            expect(outcomes.filter(o => o.accepted).map(o => o.actor)).toEqual(
                expect.arrayContaining([channelAdmin.emailAddress, defaultChannelManager.emailAddress]),
            );
            expect(outcomes.some(o => !o.accepted)).toBe(true);

            // The SuperAdmin holds every permission everywhere, so the whole matrix is visible.
            await asSuperAdminOnDefaultChannel();
            const { roleAssignments: superAdminView } = await adminClient.query(roleAssignmentsOfUserDocument, {
                userId: subject.user.id,
            });
            expect(superAdminView.totalItems).toBe(matrix.length);
        });
    });

    // OSS-751 — the role-change event contract of the assignment model. RoleAssignmentEvent
    // (channel-scoped, keyed on the User) is emitted by every actor-made assignment write and
    // is the only role-change event: the legacy RoleChangeEvent was removed in v4.0.0.
    // AdministratorEvent also fires for the administrator mutations. System-mandated rows
    // (the SuperAdmin rows materialized on Channel creation) are not reported.
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
        let eventApiKeyId: string;
        let eventApiKeyUserId: string;

        const toApiId = (id: ID) => `T_${id}`;
        const kindsOf = (events: RecordedEvent[]) => events.map(e => `${e.kind}:${e.type}`);
        const byRoleAndChannel = (
            a: { roleId: string; channelId: string },
            b: { roleId: string; channelId: string },
        ) => a.roleId.localeCompare(b.roleId) || a.channelId.localeCompare(b.channelId);

        beforeAll(async () => {
            await asSuperAdminOnDefaultChannel();
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

        it('assignRolesToUser emits RoleAssignmentEvent assigned but no AdministratorEvent', async () => {
            await adminClient.query(assignRolesToUserDocument, {
                input: {
                    userId: legacyAdmin.user.id,
                    assignments: [{ roleId: roleA.id, channelId: secondChannel.id }],
                },
            });

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['RoleAssignmentEvent:assigned']);
            expect(events[0].userId).toBe(legacyAdmin.user.id);
            expect(events[0].assignments).toEqual([{ roleId: roleA.id, channelId: secondChannel.id }]);
        });

        it('removeRolesFromUser emits RoleAssignmentEvent removed but no AdministratorEvent', async () => {
            await adminClient.query(removeRolesFromUserDocument, {
                input: {
                    userId: legacyAdmin.user.id,
                    assignments: [{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }],
                },
            });

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['RoleAssignmentEvent:removed']);
            expect(events[0].assignments).toEqual([{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }]);
        });

        it('assigning a pair already held emits nothing', async () => {
            await adminClient.query(assignRolesToUserDocument, {
                input: {
                    userId: legacyAdmin.user.id,
                    assignments: [{ roleId: roleA.id, channelId: secondChannel.id }],
                },
            });

            expect(await collectEvents()).toEqual([]);
        });

        it('removing a pair not held emits nothing', async () => {
            await adminClient.query(removeRolesFromUserDocument, {
                input: {
                    userId: legacyAdmin.user.id,
                    assignments: [{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }],
                },
            });

            expect(await collectEvents()).toEqual([]);
        });

        it('the deprecated roleIds input reports only the pairs changed on the active channel', async () => {
            // eventAdmin holds role-a on both channels. Replacing the default channel's roles
            // with role-b revokes role-a there; the second channel's rows are untouched and
            // must not be reported.
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
            expect(events[1].assignments).toEqual([{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }]);
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

        it('createApiKey emits RoleAssignmentEvent keyed on the API-key user', async () => {
            const { createApiKey } = await adminClient.query(createApiKeyDocument, {
                input: {
                    roleAssignments: [{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }],
                    translations: [{ languageCode: LanguageCode.en, name: 'Event API Key' }],
                },
            });
            eventApiKeyId = createApiKey.entityId;

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['RoleAssignmentEvent:assigned']);
            expect(events[0].userId).not.toBe(eventAdmin.user.id);
            expect(events[0].userId).not.toBe(legacyAdmin.user.id);
            expect(events[0].assignments).toEqual([{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }]);
            eventApiKeyUserId = events[0].userId;
        });

        it('deleteApiKeys removes the API-key user assignments and emits RoleAssignmentEvent removed', async () => {
            const { roleAssignments: before } = await adminClient.query(roleAssignmentsOfUserDocument, {
                userId: eventApiKeyUserId,
            });
            expect(before.totalItems).toBe(1);

            const { deleteApiKeys } = await adminClient.query(deleteApiKeysDocument, {
                ids: [eventApiKeyId],
            });
            expect(deleteApiKeys[0].result).toBe(DeletionResult.DELETED);

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['RoleAssignmentEvent:removed']);
            expect(events[0].userId).toBe(eventApiKeyUserId);
            expect(events[0].assignments).toEqual([{ roleId: roleA.id, channelId: DEFAULT_CHANNEL_ID }]);

            const { roleAssignments: after } = await adminClient.query(roleAssignmentsOfUserDocument, {
                userId: eventApiKeyUserId,
            });
            expect(after.totalItems).toBe(0);
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

        it('deleteAdministrator removes the assignments and emits RoleAssignmentEvent removed, then AdministratorEvent deleted', async () => {
            // drop role-b, so that eventAdmin holds role-a on the second channel only
            await adminClient.query(removeRolesFromUserDocument, {
                input: {
                    userId: eventAdmin.user.id,
                    assignments: [{ roleId: roleB.id, channelId: DEFAULT_CHANNEL_ID }],
                },
            });
            await collectEvents();
            const { roleAssignments: before } = await adminClient.query(roleAssignmentsOfUserDocument, {
                userId: eventAdmin.user.id,
            });
            expect(before.totalItems).toBe(1);

            const { deleteAdministrator } = await adminClient.query(deleteAdministratorDocument, {
                id: eventAdmin.id,
            });
            expect(deleteAdministrator.result).toBe(DeletionResult.DELETED);

            const events = await collectEvents();
            expect(kindsOf(events)).toEqual(['RoleAssignmentEvent:removed', 'AdministratorEvent:deleted']);
            expect(events[0].userId).toBe(eventAdmin.user.id);
            expect(events[0].assignments).toEqual([{ roleId: roleA.id, channelId: secondChannel.id }]);

            const { roleAssignments: after } = await adminClient.query(roleAssignmentsOfUserDocument, {
                userId: eventAdmin.user.id,
            });
            expect(after.totalItems).toBe(0);
        });
    });

    function byRoleCodeAndChannel(
        a: { roleCode: string; channelId: string },
        b: { roleCode: string; channelId: string },
    ) {
        return a.roleCode.localeCompare(b.roleCode) || a.channelId.localeCompare(b.channelId);
    }

    function toRoleCodeAndChannel(assignments: Array<{ role: { code: string }; channelId: string }>) {
        return assignments.map(assignment => ({
            roleCode: assignment.role.code,
            channelId: assignment.channelId,
        }));
    }

    const rolesDocument = graphql(`
        query RoleAssignmentSpecRoles {
            roles {
                items {
                    id
                    code
                }
            }
        }
    `);

    async function getUserRoleAssignments(
        administratorId: string,
    ): Promise<Array<{ roleCode: string; channelId: string }>> {
        const { administrator } = await adminClient.query(administratorRoleAssignmentsDocument, {
            id: administratorId,
        });
        return toRoleCodeAndChannel(administrator?.user.roleAssignments ?? []);
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

const roleAssignmentsOfUserDocument = graphql(`
    query RoleAssignmentsOfUser($userId: String!) {
        roleAssignments(options: { filter: { userId: { eq: $userId } } }) {
            items {
                roleId
                channelId
                role {
                    code
                }
            }
            totalItems
        }
    }
`);

const allRoleAssignmentsDocument = graphql(`
    query AllRoleAssignments {
        roleAssignments {
            items {
                roleId
                channelId
                role {
                    code
                }
            }
            totalItems
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

const deleteApiKeysDocument = graphql(`
    mutation DeleteApiKeysForEventContract($ids: [ID!]!) {
        deleteApiKeys(ids: $ids) {
            result
        }
    }
`);
