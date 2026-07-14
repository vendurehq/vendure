/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, DeletionResult, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import {
    CUSTOMER_ROLE_CODE,
    DEFAULT_CHANNEL_CODE,
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
    getChannelsDocument,
    updateAdministratorDocument,
    updateRoleDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
import { sortById } from './utils/test-order-utils';

describe('Role resolver', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    let createdRole: FragmentOf<typeof roleFragment>;
    let defaultRoles: Array<FragmentOf<typeof roleFragment>>;

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
        expect(result.roles.items.length).toBe(2);
        expect(result.roles.totalItems).toBe(2);
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

        expect(omit(createRole, ['channels'])).toEqual({
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

        expect(omit(createRole, ['channels'])).toEqual({
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
            channels: [
                {
                    code: DEFAULT_CHANNEL_CODE,
                    id: 'T_1',
                    token: 'e2e-default-channel',
                },
            ],
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

            expect(omit(result.updateRole, ['channels'])).toEqual({
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

    describe('multi-channel', () => {
        let secondChannel: ChannelFragment;
        let multiChannelRole: ResultOf<typeof createRoleDocument>['createRole'];

        beforeAll(async () => {
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
        });

        it('createRole with specified channel', async () => {
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'multi-test',
                    description: 'multi channel test role',
                    permissions: [Permission.ReadCustomer],
                    channelIds: [secondChannel.id],
                },
            });

            multiChannelRole = createRole;
            expect(createRole).toEqual({
                code: 'multi-test',
                description: 'multi channel test role',
                id: 'T_6',
                permissions: [Permission.Authenticated, Permission.ReadCustomer],
                channels: [
                    {
                        code: 'second-channel',
                        id: 'T_2',
                        token: 'second-channel-token',
                    },
                ],
            });
        });

        it('updateRole with specified channel', async () => {
            const { updateRole } = await adminClient.query(updateRoleDocument, {
                input: {
                    id: multiChannelRole.id,
                    channelIds: ['T_1', 'T_2'],
                },
            });

            expect(updateRole.channels.sort(sortById)).toEqual([
                {
                    code: DEFAULT_CHANNEL_CODE,
                    id: 'T_1',
                    token: 'e2e-default-channel',
                },
                {
                    code: 'second-channel',
                    id: 'T_2',
                    token: 'second-channel-token',
                },
            ]);
        });
    });

    // https://github.com/vendurehq/vendure/issues/1874
    describe('role escalation', () => {
        type SimpleChannel = ResultOf<typeof getChannelsDocument>['channels']['items'][number];
        let defaultChannel: SimpleChannel;
        let secondChannel: SimpleChannel;
        let limitedAdmin: FragmentOf<typeof administratorFragment>;
        let orderReaderRole: ResultOf<typeof createRoleDocument>['createRole'];
        let adminCreatorRole: ResultOf<typeof createRoleDocument>['createRole'];
        let adminCreatorAdministrator: FragmentOf<typeof administratorFragment>;

        beforeAll(async () => {
            const { channels } = await adminClient.query(getChannelsDocument);
            defaultChannel = channels.items.find(c => c.token === E2E_DEFAULT_CHANNEL_TOKEN)!;
            secondChannel = channels.items.find(c => c.token !== E2E_DEFAULT_CHANNEL_TOKEN)!;
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'second-channel-admin-manager',
                    description: '',
                    channelIds: [secondChannel.id],
                    permissions: [
                        Permission.CreateAdministrator,
                        Permission.ReadAdministrator,
                        Permission.UpdateAdministrator,
                        Permission.DeleteAdministrator,
                    ],
                },
            });

            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'channel2',
                    lastName: 'admin manager',
                    emailAddress: 'channel2@test.com',
                    roleIds: [createRole.id],
                    password: 'test',
                },
            });
            limitedAdmin = createAdministrator;

            const { createRole: createRole2 } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'second-channel-order-manager',
                    description: '',
                    channelIds: [secondChannel.id],
                    permissions: [Permission.ReadOrder],
                },
            });

            orderReaderRole = createRole2;

            adminClient.setChannelToken(secondChannel.token);
            await adminClient.asUserWithCredentials(limitedAdmin.emailAddress, 'test');
        });

        it('limited admin cannot view Roles which require permissions they do not have', async () => {
            const result = await adminClient.query(getRolesDocument);

            const roleCodes = result.roles.items.map(r => r.code);
            expect(roleCodes).toEqual(['second-channel-admin-manager']);
        });

        it('limited admin cannot view Role which requires permissions they do not have', async () => {
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
                        channelIds: [secondChannel.id],
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

        it(
            'limited admin cannot create Role with permissions it itself does not have',
            assertThrowsWithMessage(async () => {
                await adminClient.query(createRoleDocument, {
                    input: {
                        code: 'evil-order-manager',
                        description: '',
                        channelIds: [secondChannel.id],
                        permissions: [Permission.ReadOrder],
                    },
                });
            }, 'Active user does not have sufficient permissions'),
        );

        it(
            'limited admin cannot create Role on channel it does not have permissions on',
            assertThrowsWithMessage(async () => {
                await adminClient.query(createRoleDocument, {
                    input: {
                        code: 'evil-order-manager',
                        description: '',
                        channelIds: [defaultChannel.id],
                        permissions: [Permission.CreateAdministrator],
                    },
                });
            }, 'You are not currently authorized to perform this action'),
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
                    channelIds: [secondChannel.id],
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

        it(
            'limited admin cannot update Role with permissions it itself lacks',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateRoleDocument, {
                    input: {
                        id: adminCreatorRole.id,
                        permissions: [Permission.ReadOrder],
                    },
                });
            }, 'Active user does not have sufficient permissions'),
        );

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

    describe('roles query', () => {
        let limitedChannelAdmin: FragmentOf<typeof administratorFragment>

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();

            // Create roles that will be hidden from limited admin
            await adminClient.query(
                createRoleDocument,
                {
                    input: {
                        code: 'hidden-role',
                        description: 'Hidden role',
                        // Some permission the limited admin user doesn't have, so the role is hidden
                        permissions: [Permission.ReadOrder],
                    },
                },
            );

            // Create a role to assign to the limited admin user
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

            // Query first page with pagination, sorted by createdAt ASC
            const result = await adminClient.query(
                getRolesDocument,
                {
                    options: {
                        take: 2,
                    },
                },
            );

            // Should have at least visible role and test role created earlier
            expect(result.roles.items).toHaveLength(2);
            expect(result.roles.totalItems).toBe(2);

            // The returned role should be one that the limited admin can see
            const roleCodes = result.roles.items.map(r => r.code);
            expect(roleCodes).toContain('visible-role');
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
