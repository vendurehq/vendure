/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, DeletionResult, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import {
    CUSTOMER_ROLE_CODE,
    ROLE_EDITOR_ROLE_CODE,
    SUPER_ADMIN_ROLE_CODE,
} from '@vendure/common/lib/shared-constants';
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

import { administratorFragment, channelFragment, roleFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql, ResultOf } from './graphql/graphql-admin';
import {
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    updateAdministratorDocument,
    updateRoleDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

describe('Role resolver', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    let createdRole: FragmentOf<typeof roleFragment>;
    let defaultRoles: Array<FragmentOf<typeof roleFragment>>;
    let secondChannel: ChannelFragment;
    let limitedAdmin: FragmentOf<typeof administratorFragment>;
    let adminManagerRole: ResultOf<typeof createRoleDocument>['createRole'];

    type ChannelFragment = FragmentOf<typeof channelFragment>;
    const channelGuard: ErrorResultGuard<ChannelFragment> = createErrorResultGuard(
        input => !!input.defaultLanguageCode,
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

    it('roles', async () => {
        const result = await adminClient.query(getRolesDocument);

        defaultRoles = result.roles.items;
        // The three system roles: SuperAdmin, Customer, RoleEditor
        expect(result.roles.items.length).toBe(3);
        expect(result.roles.totalItems).toBe(3);
        expect(result.roles.items.map(r => r.code).sort()).toEqual(
            [SUPER_ADMIN_ROLE_CODE, CUSTOMER_ROLE_CODE, ROLE_EDITOR_ROLE_CODE].sort(),
        );
    });

    it('createRole with invalid permission', async () => {
        try {
            await adminClient.query(createRoleDocument, {
                input: {
                    code: 'test',
                    description: 'test role',
                    permissions: ['ReadCatalogx' as any],
                },
            });
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.response.errors[0]?.extensions.code).toBe('BAD_USER_INPUT');
        }
    });

    it('createRole with no permissions includes Authenticated', async () => {
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'test',
                description: 'test role',
                permissions: [],
            },
        });

        expect(createRole).toEqual({
            code: 'test',
            description: 'test role',
            id: 'T_4',
            permissions: [Permission.Authenticated],
        });
    });

    it('createRole deduplicates permissions', async () => {
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'test2',
                description: 'test role2',
                permissions: [Permission.ReadSettings, Permission.ReadSettings],
            },
        });

        expect(createRole).toEqual({
            code: 'test2',
            description: 'test role2',
            id: 'T_5',
            permissions: [Permission.Authenticated, Permission.ReadSettings],
        });
    });

    it('createRole with permissions', async () => {
        const result = await adminClient.query(createRoleDocument, {
            input: {
                code: 'test',
                description: 'test role',
                permissions: [Permission.ReadCustomer, Permission.UpdateCustomer],
            },
        });

        createdRole = result.createRole;
        expect(createdRole).toEqual({
            code: 'test',
            description: 'test role',
            id: 'T_6',
            permissions: [Permission.Authenticated, Permission.ReadCustomer, Permission.UpdateCustomer],
        });
    });

    it('role', async () => {
        const result = await adminClient.query(getRoleDocument, {
            id: createdRole.id,
        });
        expect(result.role).toEqual(createdRole);
    });

    describe('updateRole', () => {
        it('updates role', async () => {
            const result = await adminClient.query(updateRoleDocument, {
                input: {
                    id: createdRole.id,
                    code: 'test-modified',
                    description: 'test role modified',
                    permissions: [
                        Permission.ReadCustomer,
                        Permission.UpdateCustomer,
                        Permission.DeleteCustomer,
                    ],
                },
            });

            expect(result.updateRole).toEqual({
                code: 'test-modified',
                description: 'test role modified',
                id: 'T_6',
                permissions: [
                    Permission.Authenticated,
                    Permission.ReadCustomer,
                    Permission.UpdateCustomer,
                    Permission.DeleteCustomer,
                ],
            });
        });

        it('works with partial input', async () => {
            const result = await adminClient.query(updateRoleDocument, {
                input: {
                    id: createdRole.id,
                    code: 'test-modified-again',
                },
            });

            expect(result.updateRole.code).toBe('test-modified-again');
            expect(result.updateRole.description).toBe('test role modified');
            expect(result.updateRole.permissions).toEqual([
                Permission.Authenticated,
                Permission.ReadCustomer,
                Permission.UpdateCustomer,
                Permission.DeleteCustomer,
            ]);
        });

        it('deduplicates permissions', async () => {
            const result = await adminClient.query(updateRoleDocument, {
                input: {
                    id: createdRole.id,
                    permissions: [
                        Permission.Authenticated,
                        Permission.Authenticated,
                        Permission.ReadCustomer,
                        Permission.ReadCustomer,
                    ],
                },
            });

            expect(result.updateRole.permissions).toEqual([
                Permission.Authenticated,
                Permission.ReadCustomer,
            ]);
        });

        it(
            'does not allow setting non-assignable permissions - Owner',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateRoleDocument, {
                    input: {
                        id: createdRole.id,
                        permissions: [Permission.Owner],
                    },
                });
            }, 'The permission "Owner" may not be assigned'),
        );

        it(
            'does not allow setting non-assignable permissions - Public',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateRoleDocument, {
                    input: {
                        id: createdRole.id,
                        permissions: [Permission.Public],
                    },
                });
            }, 'The permission "Public" may not be assigned'),
        );

        it(
            'does not allow setting SuperAdmin permission',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateRoleDocument, {
                    input: {
                        id: createdRole.id,
                        permissions: [Permission.SuperAdmin],
                    },
                });
            }, 'The permission "SuperAdmin" may not be assigned'),
        );

        it(
            'is not allowed for SuperAdmin role',
            assertThrowsWithMessage(async () => {
                const superAdminRole = defaultRoles.find(r => r.code === SUPER_ADMIN_ROLE_CODE);
                if (!superAdminRole) {
                    fail('Could not find SuperAdmin role');
                    return;
                }
                return adminClient.query(updateRoleDocument, {
                    input: {
                        id: superAdminRole.id,
                        code: 'superadmin-modified',
                        description: 'superadmin modified',
                        permissions: [Permission.Authenticated],
                    },
                });
            }, `The role "${SUPER_ADMIN_ROLE_CODE}" cannot be modified`),
        );

        it(
            'is not allowed for Customer role',
            assertThrowsWithMessage(async () => {
                const customerRole = defaultRoles.find(r => r.code === CUSTOMER_ROLE_CODE);
                if (!customerRole) {
                    fail('Could not find Customer role');
                    return;
                }
                return adminClient.query(updateRoleDocument, {
                    input: {
                        id: customerRole.id,
                        code: 'customer-modified',
                        description: 'customer modified',
                        permissions: [Permission.Authenticated, Permission.DeleteAdministrator],
                    },
                });
            }, `The role "${CUSTOMER_ROLE_CODE}" cannot be modified`),
        );

        it(
            'is not allowed for RoleEditor role',
            assertThrowsWithMessage(async () => {
                const roleEditorRole = defaultRoles.find(r => r.code === ROLE_EDITOR_ROLE_CODE);
                if (!roleEditorRole) {
                    fail('Could not find RoleEditor role');
                    return;
                }
                return adminClient.query(updateRoleDocument, {
                    input: {
                        id: roleEditorRole.id,
                        code: 'role-editor-modified',
                        description: 'role editor modified',
                        permissions: [Permission.Authenticated],
                    },
                });
            }, `The role "${ROLE_EDITOR_ROLE_CODE}" cannot be modified`),
        );
    });

    it(
        'deleteRole is not allowed for Customer role',
        assertThrowsWithMessage(async () => {
            const customerRole = defaultRoles.find(r => r.code === CUSTOMER_ROLE_CODE);
            if (!customerRole) {
                fail('Could not find Customer role');
                return;
            }
            return adminClient.query(deleteRoleDocument, {
                id: customerRole.id,
            });
        }, `The role "${CUSTOMER_ROLE_CODE}" cannot be deleted`),
    );

    it(
        'deleteRole is not allowed for SuperAdmin role',
        assertThrowsWithMessage(async () => {
            const superAdminRole = defaultRoles.find(r => r.code === SUPER_ADMIN_ROLE_CODE);
            if (!superAdminRole) {
                fail('Could not find Customer role');
                return;
            }
            return adminClient.query(deleteRoleDocument, {
                id: superAdminRole.id,
            });
        }, `The role "${SUPER_ADMIN_ROLE_CODE}" cannot be deleted`),
    );

    it(
        'deleteRole is not allowed for RoleEditor role',
        assertThrowsWithMessage(async () => {
            const roleEditorRole = defaultRoles.find(r => r.code === ROLE_EDITOR_ROLE_CODE);
            if (!roleEditorRole) {
                fail('Could not find RoleEditor role');
                return;
            }
            return adminClient.query(deleteRoleDocument, {
                id: roleEditorRole.id,
            });
        }, `The role "${ROLE_EDITOR_ROLE_CODE}" cannot be deleted`),
    );

    it('deleteRole deletes a role', async () => {
        const { deleteRole } = await adminClient.query(deleteRoleDocument, {
            id: createdRole.id,
        });

        expect(deleteRole.result).toBe(DeletionResult.DELETED);

        const { role } = await adminClient.query(getRoleDocument, {
            id: createdRole.id,
        });
        expect(role).toBeNull();
    });

    // https://github.com/vendurehq/vendure/issues/1874
    describe('role escalation', () => {
        let orderReaderRole: ResultOf<typeof createRoleDocument>['createRole'];
        let adminCreatorRole: ResultOf<typeof createRoleDocument>['createRole'];
        let adminCreatorAdministrator: FragmentOf<typeof administratorFragment>;
        let escalatedRole: ResultOf<typeof createRoleDocument>['createRole'];

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
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
                    code: 'second-channel-admin-manager',
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
                    firstName: 'channel2',
                    lastName: 'admin manager',
                    emailAddress: 'channel2@test.com',
                    roleAssignments: [{ roleId: createRole.id, channelId: secondChannel.id }],
                    password: 'test',
                },
            });
            limitedAdmin = createAdministrator;

            const { createRole: createRole2 } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'second-channel-order-manager',
                    description: '',
                    permissions: [Permission.ReadOrder],
                },
            });

            orderReaderRole = createRole2;

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials(limitedAdmin.emailAddress, 'test');
        });

        // A Role is visible iff the actor holds ReadRole on every channel where the Role
        // currently has assignment rows (the RoleEditor gate, OSS-749).
        it('limited admin sees Roles according to the assigned-channels gate', async () => {
            const result = await adminClient.query(getRolesDocument);

            // The limited admin holds RoleEditor (auto-granted on creation) on
            // second-channel only, so:
            // - second-channel-admin-manager: assigned on second-channel only -> visible
            // - second-channel-order-manager: zero assignments -> vacuously visible
            //   (accepted known issue, TODOs §7)
            // - test & test2: zero assignments -> visible
            // - system roles (SuperAdmin, Customer, RoleEditor): bypass the gate since they
            //   cannot be modified or deleted anyway -> always visible
            const roleCodes = result.roles.items.map(r => r.code).sort();
            expect(roleCodes).toEqual(
                [
                    CUSTOMER_ROLE_CODE,
                    ROLE_EDITOR_ROLE_CODE,
                    SUPER_ADMIN_ROLE_CODE,
                    'second-channel-admin-manager',
                    'second-channel-order-manager',
                    'test',
                    'test2',
                ].sort(),
            );
        });

        // System roles are not editable through the API, so the gate does not apply to
        // reading them: they are visible on every channel. The SuperAdmin role is the
        // strongest case since it is materialized on all channels.
        it('limited admin can view system roles regardless of channel assignments', async () => {
            const superAdminRole = defaultRoles.find(r => r.code === SUPER_ADMIN_ROLE_CODE)!;
            const result = await adminClient.query(getRoleDocument, { id: superAdminRole.id });

            expect(result.role?.code).toBe(SUPER_ADMIN_ROLE_CODE);
        });

        // A Role with no assignments passes the gate vacuously (accepted known issue, TODOs §7)
        it('limited admin can view a Role with zero assignments', async () => {
            const result = await adminClient.query(getRoleDocument, { id: orderReaderRole.id });

            expect(result.role?.code).toBe('second-channel-order-manager');
        });

        it(
            'limited admin cannot create Role with SuperAdmin permission',
            assertThrowsWithMessage(async () => {
                await adminClient.query(createRoleDocument, {
                    input: {
                        code: 'evil-superadmin',
                        description: '',
                        permissions: [Permission.SuperAdmin],
                    },
                });
            }, 'The permission "SuperAdmin" may not be assigned'),
        );

        it(
            'limited admin cannot create Administrator with SuperAdmin role',
            assertThrowsWithMessage(async () => {
                const superAdminRole = defaultRoles.find(r => r.code === SUPER_ADMIN_ROLE_CODE)!;
                await adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'Dr',
                        lastName: 'Evil',
                        emailAddress: 'drevil@test.com',
                        roleIds: [superAdminRole.id],
                        password: 'test',
                    },
                });
            }, 'Active user does not have sufficient permissions'),
        );

        // The permission-envelope check on role CRUD was removed in favor of the RoleEditor
        // gate (ruling 2026-08-31): a RoleEditor holder can write permissions they do not
        // themselves hold into a Role. Recorded self-escalation caveat: RoleEditor is
        // high-trust.
        it('limited admin can create a Role with permissions it does not itself hold', async () => {
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'escalated-order-manager',
                    description: '',
                    permissions: [Permission.ReadOrder],
                },
            });

            expect(createRole.code).toBe('escalated-order-manager');
            expect(createRole.permissions).toEqual([Permission.Authenticated, Permission.ReadOrder]);
            escalatedRole = createRole;
        });

        it(
            'limited admin cannot create Administrator with a Role with greater permissions than they themselves have',
            assertThrowsWithMessage(async () => {
                await adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'Dr',
                        lastName: 'Evil',
                        emailAddress: 'drevil@test.com',
                        roleIds: [orderReaderRole.id],
                        password: 'test',
                    },
                });
            }, 'Active user does not have sufficient permissions'),
        );

        it('limited admin can create Role with permissions it itself has', async () => {
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'good-admin-creator',
                    description: '',
                    permissions: [Permission.CreateAdministrator],
                },
            });

            expect(createRole.code).toBe('good-admin-creator');
            adminCreatorRole = createRole;
        });

        it('limited admin can create Administrator with permissions it itself has', async () => {
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Admin',
                    lastName: 'Creator',
                    emailAddress: 'admincreator@test.com',
                    roleIds: [adminCreatorRole.id],
                    password: 'test',
                },
            });

            expect(createAdministrator.emailAddress).toBe('admincreator@test.com');
            adminCreatorAdministrator = createAdministrator;
        });

        // Counterpart of the create case above: the envelope check is gone from updateRole
        // too. The gate passes because escalated-order-manager has zero assignments.
        it('limited admin can update a Role it manages with permissions it does not itself hold', async () => {
            const result = await adminClient.query(updateRoleDocument, {
                input: {
                    id: escalatedRole.id,
                    permissions: [Permission.ReadOrder, Permission.ReadCustomer],
                },
            });

            expect(result.updateRole.permissions).toEqual([
                Permission.Authenticated,
                Permission.ReadOrder,
                Permission.ReadCustomer,
            ]);
        });

        it(
            'limited admin cannot update Administrator with Role containing permissions it itself lacks',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateAdministratorDocument, {
                    input: {
                        id: adminCreatorAdministrator.id,
                        roleIds: [adminCreatorRole.id, orderReaderRole.id],
                    },
                });
            }, 'Active user does not have sufficient permissions'),
        );
    });

    // The RoleEditor gate on specific Roles (OSS-749): an actor may read / update / delete
    // a Role iff they hold the corresponding Role CRUD permission on every channel where
    // that Role currently has assignment rows.
    describe('role CRUD gate', () => {
        const DEFAULT_CHANNEL_ID = 'T_1';
        let crossChannelRole: ResultOf<typeof createRoleDocument>['createRole'];
        let roleEditorRole: FragmentOf<typeof roleFragment>;

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            roleEditorRole = defaultRoles.find(r => r.code === ROLE_EDITOR_ROLE_CODE)!;

            // A Role assigned on both channels: managing it requires the permission on both.
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'cross-channel-role',
                    description: '',
                    permissions: [Permission.ReadCustomer],
                },
            });
            crossChannelRole = createRole;
            await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Cross',
                    lastName: 'Channel',
                    emailAddress: 'cross@test.com',
                    password: 'test',
                    roleAssignments: [
                        { roleId: crossChannelRole.id, channelId: DEFAULT_CHANNEL_ID },
                        { roleId: crossChannelRole.id, channelId: secondChannel.id },
                    ],
                },
            });
        });

        it('an administrator stripped of RoleEditor is denied role CRUD by the resolver', async () => {
            // Every administrator receives RoleEditor on creation, but it is an ordinary
            // assignment row: a replace-set write which omits it revokes it.
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Stripped',
                    lastName: 'Admin',
                    emailAddress: 'stripped@test.com',
                    password: 'test',
                    roleAssignments: [{ roleId: adminManagerRole.id, channelId: secondChannel.id }],
                },
            });
            await adminClient.query(updateAdministratorDocument, {
                input: {
                    id: createAdministrator.id,
                    roleAssignments: [{ roleId: adminManagerRole.id, channelId: secondChannel.id }],
                },
            });

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials('stripped@test.com', 'test');
            await assertThrowsWithMessage(async () => {
                await adminClient.query(getRolesDocument);
            }, 'You are not currently authorized to perform this action')();
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createRoleDocument, {
                    input: { code: 'no-create-role', description: '', permissions: [] },
                });
            }, 'You are not currently authorized to perform this action')();
        });

        it('RoleEditor on one channel cannot see a Role also assigned on another channel', async () => {
            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials(limitedAdmin.emailAddress, 'test');

            const { role } = await adminClient.query(getRoleDocument, { id: crossChannelRole.id });
            expect(role).toBeNull();
        });

        it('update and delete of such a Role are denied as not found', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(updateRoleDocument, {
                    input: { id: crossChannelRole.id, description: 'hijacked' },
                });
            }, 'No Role with the id')();
            await assertThrowsWithMessage(async () => {
                await adminClient.query(deleteRoleDocument, { id: crossChannelRole.id });
            }, 'No Role with the id')();
        });

        // The denial surface of the gate itself (as opposed to the read gate hiding the
        // Role, or the grant guard on assignment writes): an actor who can read the Role
        // on every assigned channel but lacks UpdateRole on one of them.
        it('gate denial is distinguishable from a grant-guard denial', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: { code: 'role-reader', description: '', permissions: [Permission.ReadRole] },
            });
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Role',
                    lastName: 'Reader',
                    emailAddress: 'reader@test.com',
                    password: 'test',
                    roleAssignments: [
                        { roleId: createRole.id, channelId: DEFAULT_CHANNEL_ID },
                        { roleId: roleEditorRole.id, channelId: secondChannel.id },
                    ],
                },
            });
            // Strip the creation-granted RoleEditor from the default channel, keeping only
            // the read-only role there: reader@test.com now holds ReadRole on both channels
            // but UpdateRole only on second-channel.
            await adminClient.query(updateAdministratorDocument, {
                input: {
                    id: createAdministrator.id,
                    roleAssignments: [
                        { roleId: createRole.id, channelId: DEFAULT_CHANNEL_ID },
                        { roleId: roleEditorRole.id, channelId: secondChannel.id },
                    ],
                },
            });

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials('reader@test.com', 'test');
            // Visible: ReadRole is held on both assigned channels
            const { role } = await adminClient.query(getRoleDocument, { id: crossChannelRole.id });
            expect(role?.code).toBe('cross-channel-role');
            // ...but UpdateRole is missing on the default channel
            await assertThrowsWithMessage(
                async () => {
                    await adminClient.query(updateRoleDocument, {
                        input: { id: crossChannelRole.id, description: 'hijacked' },
                    });
                },
                'Active user does not have permission to manage the role "cross-channel-role" ' +
                    'on every channel where it is assigned',
            )();
        });

        it('can update and delete the Role once granted RoleEditor on the other channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            // assignRoleToAdministrator grants on the active channel: the default channel
            await adminClient.query(assignRoleToAdministratorDocument, {
                administratorId: limitedAdmin.id,
                roleId: roleEditorRole.id,
            });

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials(limitedAdmin.emailAddress, 'test');
            const { updateRole } = await adminClient.query(updateRoleDocument, {
                input: { id: crossChannelRole.id, description: 'now manageable' },
            });
            expect(updateRole.description).toBe('now manageable');

            const { deleteRole } = await adminClient.query(deleteRoleDocument, {
                id: crossChannelRole.id,
            });
            expect(deleteRole.result).toBe(DeletionResult.DELETED);
        });
    });

    describe('roles query', () => {
        let limitedChannelAdmin: FragmentOf<typeof administratorFragment>

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();

            // A role with zero assignments would be vacuously visible (TODOs §7), so to be
            // hidden from the limited admin it is assigned on second-channel, where the
            // limited admin will hold no RoleEditor grant.
            const hiddenRole = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'hidden-role',
                    description: 'Hidden role',
                    permissions: [Permission.ReadOrder],
                },
            });
            await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Hidden',
                    lastName: 'Holder',
                    emailAddress: 'hiddenholder@test.com',
                    password: 'test',
                    roleAssignments: [{ roleId: hiddenRole.createRole.id, channelId: secondChannel.id }],
                },
            });

            // Create a role to assign to the limited admin user on the default channel
            const visibleRole = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'visible-role',
                    description: 'Visible role',
                    permissions: [Permission.ReadAdministrator],
                },
            });

            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Limited',
                    lastName: 'Admin',
                    emailAddress: 'limited@test.com',
                    roleIds: [visibleRole.createRole.id],
                    password: 'test',
                },
            });
            limitedChannelAdmin = createAdministrator;
        });

        it('should return only visible roles with correct pagination', async () => {
            // Login as limited admin
            await adminClient.asUserWithCredentials(limitedChannelAdmin.emailAddress, 'test');

            // limited@test.com holds ReadRole (via the creation-granted RoleEditor) on the
            // default channel only. Visible = roles whose assigned channels are a subset of
            // {default channel}:
            // - visible-role: assigned to limited@test.com on the default channel
            // - role-reader: assigned to reader@test.com on the default channel (gate suite)
            // - zero-assignment roles: test, test2, second-channel-order-manager,
            //   escalated-order-manager
            // - system roles (SuperAdmin, Customer, RoleEditor): bypass the gate
            // Invisible: second-channel-admin-manager, good-admin-creator and hidden-role
            // (all assigned on second-channel only).
            const allVisible = await adminClient.query(getRolesDocument);
            expect(allVisible.roles.items.map(r => r.code).sort()).toEqual(
                [
                    CUSTOMER_ROLE_CODE,
                    ROLE_EDITOR_ROLE_CODE,
                    SUPER_ADMIN_ROLE_CODE,
                    'escalated-order-manager',
                    'role-reader',
                    'second-channel-order-manager',
                    'test',
                    'test2',
                    'visible-role',
                ].sort(),
            );

            // Pagination and totals operate over the visible set only
            const result = await adminClient.query(getRolesDocument, {
                options: {
                    take: 2,
                },
            });
            expect(result.roles.items).toHaveLength(2);
            expect(result.roles.totalItems).toBe(9);
            const roleCodes = result.roles.items.map(r => r.code);
            expect(roleCodes).not.toContain('hidden-role');
        });

        afterAll(async () => {
            await adminClient.asSuperAdmin();
        });
    });
});

export const getRolesDocument = graphql(
    `
        query GetRoles($options: RoleListOptions) {
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

export const getRoleDocument = graphql(
    `
        query GetRole($id: ID!) {
            role(id: $id) {
                ...Role
            }
        }
    `,
    [roleFragment],
);

export const deleteRoleDocument = graphql(`
    mutation DeleteRole($id: ID!) {
        deleteRole(id: $id) {
            result
            message
        }
    }
`);

export const assignRoleToAdministratorDocument = graphql(`
    mutation AssignRoleToAdministrator($administratorId: ID!, $roleId: ID!) {
        assignRoleToAdministrator(administratorId: $administratorId, roleId: $roleId) {
            id
        }
    }
`);
