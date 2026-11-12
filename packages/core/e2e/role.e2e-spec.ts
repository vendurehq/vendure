/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, DeletionResult, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { ROLE_EDITOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import path from 'path';
import { fail } from 'assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { administratorFragment, channelFragment, roleFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql, ResultOf } from './graphql/graphql-admin';
import {
    assignRolesToUserDocument,
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    deleteChannelDocument,
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
        // The two system roles: SuperAdmin, RoleEditor. There is no Customer role: customer
        // permissions are membership-derived (Authenticated on every member channel).
        expect(result.roles.items.length).toBe(2);
        expect(result.roles.totalItems).toBe(2);
        expect(result.roles.items.map(r => r.code).sort()).toEqual(
            [SUPER_ADMIN_ROLE_CODE, ROLE_EDITOR_ROLE_CODE].sort(),
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
            id: 'T_3',
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
            id: 'T_4',
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
            id: 'T_5',
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
                id: 'T_5',
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
        let unheldRole: ResultOf<typeof createRoleDocument>['createRole'];

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

            // RoleEditor is an explicit grant: the limited admin receives it on second-channel
            // alongside the admin-manager role.
            const roleEditorRole = defaultRoles.find(r => r.code === ROLE_EDITOR_ROLE_CODE)!;
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'channel2',
                    lastName: 'admin manager',
                    emailAddress: 'channel2@test.com',
                    roleAssignments: [
                        { roleId: createRole.id, channelId: secondChannel.id },
                        { roleId: roleEditorRole.id, channelId: secondChannel.id },
                    ],
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

        // A Role is visible iff the actor holds ReadRole on its owning channel, or may grant
        // it somewhere. All Roles so far were created on the default channel, so they are
        // shared Roles, and the limited admin holds RoleEditor on second-channel only.
        it('limited admin sees the Roles it owns or may grant', async () => {
            const result = await adminClient.query(getRolesDocument);

            // - second-channel-admin-manager: grantable on second-channel -> visible
            // - test: carries only Authenticated, grantable anywhere -> visible
            // - second-channel-order-manager, test2: permissions not held -> hidden, although
            //   they have no assignments
            // - system roles (SuperAdmin, RoleEditor): bypass the gate since they
            //   cannot be modified or deleted anyway -> always visible
            const roleCodes = result.roles.items.map(r => r.code).sort();
            expect(roleCodes).toEqual(
                [ROLE_EDITOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE, 'second-channel-admin-manager', 'test'].sort(),
            );
        });

        // System roles are not editable through the API, so the gate does not apply to
        // reading them: they are visible on every channel. The SuperAdmin role is the
        // strongest case since its single default-channel row stands for every channel.
        it('limited admin can view system roles regardless of channel assignments', async () => {
            const superAdminRole = defaultRoles.find(r => r.code === SUPER_ADMIN_ROLE_CODE)!;
            const result = await adminClient.query(getRoleDocument, { id: superAdminRole.id });

            expect(result.role?.code).toBe(SUPER_ADMIN_ROLE_CODE);
        });

        // A Role owned by the default channel is not readable through RoleEditor on another
        // channel, whether or not it has assignments.
        it('limited admin cannot view a shared Role with zero assignments it may not grant', async () => {
            const result = await adminClient.query(getRoleDocument, { id: orderReaderRole.id });

            expect(result.role).toBeNull();
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

        // The permission-envelope rule: a Role may only carry permissions the actor holds.
        // Without it a RoleEditor holder could write any permission into a Role they hold
        // themselves and receive it on their next request.
        it(
            'limited admin cannot create a Role with permissions it does not itself hold',
            assertThrowsWithMessage(async () => {
                await adminClient.query(createRoleDocument, {
                    input: {
                        code: 'escalated-order-manager',
                        description: '',
                        permissions: [Permission.ReadOrder],
                    },
                });
            }, 'Active user does not have sufficient permissions'),
        );

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

        // second-channel-admin-manager is a shared Role, owned by the default channel, so
        // RoleEditor on second-channel does not let the limited admin edit it, although they
        // hold it themselves.
        it(
            'limited admin cannot edit a shared Role it holds itself',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateRoleDocument, {
                    input: {
                        id: adminManagerRole.id,
                        permissions: [
                            Permission.CreateAdministrator,
                            Permission.ReadAdministrator,
                            Permission.UpdateAdministrator,
                            Permission.DeleteAdministrator,
                            Permission.ReadOrder,
                        ],
                    },
                });
            }, 'Active user does not have permission to manage the role "second-channel-admin-manager"'),
        );

        // A shared Role with no assignments is out of reach too: it is not even readable.
        it(
            'limited admin cannot update a shared Role with no assignments',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateRoleDocument, {
                    input: {
                        id: orderReaderRole.id,
                        permissions: [Permission.ReadOrder, Permission.ReadCustomer],
                    },
                });
            }, 'No Role with the id'),
        );

        // The envelope rule on updateRole, for a Role the actor owns: good-admin-creator was
        // created on second-channel, so it is owned by it. Adding a permission the actor does
        // not hold there is refused.
        it(
            'limited admin cannot add permissions it does not hold to a Role its channel owns',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateRoleDocument, {
                    input: {
                        id: adminCreatorRole.id,
                        permissions: [Permission.CreateAdministrator, Permission.ReadOrder],
                    },
                });
            }, 'Active user does not have sufficient permissions'),
        );

        it('limited admin can update a Role it manages with permissions it holds', async () => {
            const result = await adminClient.query(updateRoleDocument, {
                input: {
                    id: adminCreatorRole.id,
                    description: 'creates administrators',
                    permissions: [Permission.CreateAdministrator, Permission.ReadAdministrator],
                },
            });

            expect(result.updateRole.description).toBe('creates administrators');
            expect(result.updateRole.permissions).toEqual([
                Permission.Authenticated,
                Permission.CreateAdministrator,
                Permission.ReadAdministrator,
            ]);
        });

        // assignRoleToAdministrator writes through the same guarded path as
        // assignRolesToUser: a Role the actor could not grant is refused even when it has
        // no assignments and is therefore readable.
        it('limited admin cannot grant a Role it does not hold via assignRoleToAdministrator', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: { code: 'unheld-role', description: '', permissions: [Permission.ReadOrder] },
            });
            unheldRole = createRole;

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials(limitedAdmin.emailAddress, 'test');
            await assertThrowsWithMessage(async () => {
                await adminClient.query(assignRoleToAdministratorDocument, {
                    administratorId: limitedAdmin.id,
                    roleId: unheldRole.id,
                });
            }, 'Active user does not have sufficient permissions')();
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

        it('an administrator without RoleEditor is denied role CRUD but can list the Roles it could grant', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'No',
                    lastName: 'RoleEditor',
                    emailAddress: 'no-role-editor@test.com',
                    password: 'test',
                    roleAssignments: [{ roleId: adminManagerRole.id, channelId: secondChannel.id }],
                },
            });

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials('no-role-editor@test.com', 'test');
            // The roles query is open to ReadAdministrator holders so that an administrator
            // who manages other administrators can pick the Roles to grant. Visible are the
            // system roles and the Roles whose permission list the actor holds on at least
            // one channel.
            const { roles } = await adminClient.query(getRolesDocument);
            expect(roles.items.map(r => r.code).sort()).toEqual(
                [
                    ROLE_EDITOR_ROLE_CODE,
                    SUPER_ADMIN_ROLE_CODE,
                    'good-admin-creator',
                    'second-channel-admin-manager',
                    'test',
                ].sort(),
            );
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
            // reader@test.com holds ReadRole on both channels but UpdateRole only on
            // second-channel.

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials('reader@test.com', 'test');
            // Visible: ReadRole is held on both assigned channels
            const { role } = await adminClient.query(getRoleDocument, { id: crossChannelRole.id });
            expect(role?.code).toBe('cross-channel-role');
            // ...but UpdateRole is missing on the default channel
            await assertThrowsWithMessage(async () => {
                await adminClient.query(updateRoleDocument, {
                    input: { id: crossChannelRole.id, description: 'hijacked' },
                });
            }, 'Active user does not have permission to manage the role "cross-channel-role" ' + 'on the channel which owns it')();
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

    // The grant clause of the read gate (OSS-800): a Role is visible to an actor who holds
    // its full permission list on at least one channel, whatever channels it is assigned on,
    // because that actor may grant it on their own channel. The envelope check itself is
    // per channel, so the same actor cannot grant it where they lack the permissions.
    describe('roles visible under the grant rule', () => {
        const DEFAULT_CHANNEL_ID = 'T_1';
        let spanningRole: ResultOf<typeof createRoleDocument>['createRole'];
        let unheldSpanningRole: ResultOf<typeof createRoleDocument>['createRole'];
        let holder: FragmentOf<typeof administratorFragment>;
        let grantee: FragmentOf<typeof administratorFragment>;

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            // Held by the actor (no-role-editor@test.com holds the admin-manager role on
            // second-channel), assigned on both channels
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'spanning-admin-reader',
                    description: '',
                    permissions: [Permission.ReadAdministrator, Permission.UpdateAdministrator],
                },
            });
            spanningRole = createRole;
            // Held by the actor nowhere, assigned on both channels
            const { createRole: createRole2 } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'spanning-order-reader',
                    description: '',
                    permissions: [Permission.ReadOrder],
                },
            });
            unheldSpanningRole = createRole2;
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Spanning',
                    lastName: 'Holder',
                    emailAddress: 'spanning@test.com',
                    password: 'test',
                    roleAssignments: [
                        { roleId: spanningRole.id, channelId: DEFAULT_CHANNEL_ID },
                        { roleId: spanningRole.id, channelId: secondChannel.id },
                        { roleId: unheldSpanningRole.id, channelId: DEFAULT_CHANNEL_ID },
                        { roleId: unheldSpanningRole.id, channelId: secondChannel.id },
                    ],
                },
            });
            holder = createAdministrator;
            // The actor has no authority over holder, who holds Roles it may not grant, so
            // grants go to an Administrator holding only a Role the actor may grant. One holding
            // nothing would be outside the actor's authority, which lacks UpdateAdministrator on
            // the default channel.
            const { createAdministrator: createGrantee } = await adminClient.query(
                createAdministratorDocument,
                {
                    input: {
                        firstName: 'Spanning',
                        lastName: 'Grantee',
                        emailAddress: 'spanning-grantee@test.com',
                        password: 'test',
                        roleAssignments: [{ roleId: adminManagerRole.id, channelId: secondChannel.id }],
                    },
                },
            );
            grantee = createGrantee;

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials('no-role-editor@test.com', 'test');
        });

        it('a Role assigned on another channel too is visible to an actor who may grant it on theirs', async () => {
            const { roles } = await adminClient.query(getRolesDocument);
            expect(roles.items.map(r => r.code)).toContain(spanningRole.code);

            const { role } = await adminClient.query(getRoleDocument, { id: spanningRole.id });
            expect(role?.code).toBe(spanningRole.code);
        });

        it('and the actor may grant it on their channel', async () => {
            const { assignRolesToUser } = await adminClient.query(assignRolesToUserDocument, {
                input: {
                    userId: grantee.user.id,
                    assignments: [{ roleId: spanningRole.id, channelId: secondChannel.id }],
                },
            });
            expect(
                assignRolesToUser.roleAssignments.some(
                    a => a.roleId === spanningRole.id && a.channelId === secondChannel.id,
                ),
            ).toBe(true);
        });

        it(
            'but not on a channel where they lack its permissions',
            assertThrowsWithMessage(async () => {
                await adminClient.query(assignRolesToUserDocument, {
                    input: {
                        userId: grantee.user.id,
                        assignments: [{ roleId: spanningRole.id, channelId: DEFAULT_CHANNEL_ID }],
                    },
                });
                // The actor lacks UpdateAdministrator on the default channel
            }, 'You are not currently authorized to perform this action'),
        );

        it('a Role whose permissions the actor holds nowhere stays hidden', async () => {
            const { roles } = await adminClient.query(getRolesDocument);
            expect(roles.items.map(r => r.code)).not.toContain(unheldSpanningRole.code);

            const { role } = await adminClient.query(getRoleDocument, { id: unheldSpanningRole.id });
            expect(role).toBeNull();
        });
    });

    // OSS-300: every Role is owned by the channel it was created on.
    describe('role ownership', () => {
        let ownedChannel: ChannelFragment;
        let ownedRole: ResultOf<typeof createRoleDocument>['createRole'];

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'owned-channel',
                    token: 'owned-channel-token',
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            channelGuard.assertSuccess(createChannel);
            ownedChannel = createChannel;
        });

        it('a Role created on the default channel is a shared Role, owned by it', async () => {
            const { role } = await adminClient.query(getRoleOwnerDocument, { id: adminManagerRole.id });
            expect(role?.channel?.code).toBe('__default_channel__');
        });

        it('the system roles are owned by the default channel', async () => {
            const superAdminRole = defaultRoles.find(r => r.code === SUPER_ADMIN_ROLE_CODE)!;
            const { role } = await adminClient.query(getRoleOwnerDocument, { id: superAdminRole.id });
            expect(role?.channel?.code).toBe('__default_channel__');
        });

        it('a Role created on another channel is owned by it', async () => {
            adminClient.setChannelToken(ownedChannel.token);
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: { code: 'owned-role', description: '', permissions: [Permission.ReadOrder] },
            });
            ownedRole = createRole;
            const { role } = await adminClient.query(getRoleOwnerDocument, { id: ownedRole.id });
            expect(role?.channel?.id).toBe(ownedChannel.id);
        });

        it(
            'a Role owned by a channel cannot be assigned on another channel, even by a SuperAdmin',
            assertThrowsWithMessage(async () => {
                await adminClient.query(assignRolesToUserDocument, {
                    input: {
                        userId: limitedAdmin.user.id,
                        assignments: [{ roleId: ownedRole.id, channelId: secondChannel.id }],
                    },
                });
            }, 'Active user does not have sufficient permissions'),
        );

        it('deleting a channel deletes the Roles it owns', async () => {
            await adminClient.query(assignRolesToUserDocument, {
                input: {
                    userId: limitedAdmin.user.id,
                    assignments: [{ roleId: ownedRole.id, channelId: ownedChannel.id }],
                },
            });
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { deleteChannel } = await adminClient.query(deleteChannelDocument, { id: ownedChannel.id });
            expect(deleteChannel.result).toBe(DeletionResult.DELETED);

            const { role } = await adminClient.query(getRoleOwnerDocument, { id: ownedRole.id });
            expect(role).toBeNull();
            // the shared Roles are untouched
            const { role: shared } = await adminClient.query(getRoleOwnerDocument, {
                id: adminManagerRole.id,
            });
            expect(shared?.id).toBe(adminManagerRole.id);
        });
    });

    describe('roles query', () => {
        let limitedChannelAdmin: FragmentOf<typeof administratorFragment>;

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();

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

            const roleEditorRole = defaultRoles.find(r => r.code === ROLE_EDITOR_ROLE_CODE)!;
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Limited',
                    lastName: 'Admin',
                    emailAddress: 'limited@test.com',
                    roleAssignments: [
                        { roleId: visibleRole.createRole.id, channelId: 'T_1' },
                        { roleId: roleEditorRole.id, channelId: 'T_1' },
                    ],
                    password: 'test',
                },
            });
            limitedChannelAdmin = createAdministrator;
        });

        it('should return only visible roles with correct pagination', async () => {
            // Login as limited admin
            await adminClient.asUserWithCredentials(limitedChannelAdmin.emailAddress, 'test');

            // limited@test.com holds ReadRole (via RoleEditor) on the default channel only.
            // Visible = the shared roles, owned by the default channel, wherever they are
            // assigned: every role created by the SuperAdmin on the default channel.
            // Invisible: good-admin-creator, owned by second-channel.
            const allVisible = await adminClient.query(getRolesDocument);
            const expectedCodes = [
                ROLE_EDITOR_ROLE_CODE,
                SUPER_ADMIN_ROLE_CODE,
                'hidden-role',
                'role-reader',
                'second-channel-admin-manager',
                'second-channel-order-manager',
                'spanning-admin-reader',
                'spanning-order-reader',
                'test',
                'test2',
                'unheld-role',
                'visible-role',
            ].sort();
            expect(allVisible.roles.items.map(r => r.code).sort()).toEqual(expectedCodes);

            // Pagination and totals operate over the visible set only
            const result = await adminClient.query(getRolesDocument, {
                options: {
                    take: 2,
                },
            });
            expect(result.roles.items).toHaveLength(2);
            expect(result.roles.totalItems).toBe(expectedCodes.length);
            const roleCodes = result.roles.items.map(r => r.code);
            expect(roleCodes).not.toContain('good-admin-creator');
        });

        afterAll(async () => {
            await adminClient.asSuperAdmin();
        });
    });
});

const getRoleOwnerDocument = graphql(`
    query GetRoleOwner($id: ID!) {
        role(id: $id) {
            id
            code
            channel {
                id
                code
            }
        }
    }
`);

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
