import { mergeConfig } from '@vendure/core';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { createTestEnvironment } from '../../testing/lib/create-test-environment';

import {
    sync,
    TestPluginWithCustomPermissions,
    wishlist,
} from './fixtures/test-plugins/with-custom-permissions';
import {
    crudCreateDocument,
    crudDeleteDocument,
    crudReadDocument,
    crudUpdateDocument,
    syncCustomPermissionsDocument,
} from './graphql/admin-definitions';
import { ResultOf } from './graphql/graphql-admin';
import {
    createAdministratorDocument,
    createRoleDocument,
    updateRoleDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

describe('Custom permissions', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TestPluginWithCustomPermissions],
        }),
    );

    let testRole: ResultOf<typeof createRoleDocument>['createRole'];
    let testAdmin: ResultOf<typeof createAdministratorDocument>['createAdministrator'];

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        // create a new role and Admin and sign in as that Admin
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                channelIds: ['T_1'],
                code: 'test-role',
                description: 'Testing custom permissions',
                permissions: [],
            },
        });
        testRole = createRole;
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Test',
                lastName: 'Admin',
                emailAddress: 'test@admin.com',
                password: 'test',
                roleIds: [testRole.id],
            },
        });

        testAdmin = createAdministrator;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('superadmin has custom permissions automatically', () => {
        beforeAll(async () => {
            await adminClient.asSuperAdmin();
        });

        it('single permission', async () => {
            const { syncWishlist } = await adminClient.query(syncCustomPermissionsDocument);
            expect(syncWishlist).toBe(true);
        });

        it('CRUD create permission', async () => {
            const { createWishlist } = await adminClient.query(crudCreateDocument);
            expect(createWishlist).toBe(true);
        });

        it('CRUD read permission', async () => {
            // eslint-disable-next-line no-shadow,@typescript-eslint/no-shadow
            const { wishlist } = await adminClient.query(crudReadDocument);
            expect(wishlist).toBe(true);
        });

        it('CRUD update permission', async () => {
            const { updateWishlist } = await adminClient.query(crudUpdateDocument);
            expect(updateWishlist).toBe(true);
        });

        it('CRUD delete permission', async () => {
            const { deleteWishlist } = await adminClient.query(crudDeleteDocument);
            expect(deleteWishlist).toBe(true);
        });
    });

    describe('custom permissions prevent unauthorized access', () => {
        beforeAll(async () => {
            await adminClient.asUserWithCredentials(testAdmin.emailAddress, 'test');
        });

        it(
            'single permission',
            assertThrowsWithMessage(async () => {
                await adminClient.query(syncCustomPermissionsDocument);
            }, 'You are not currently authorized to perform this action'),
        );

        it(
            'CRUD create permission',
            assertThrowsWithMessage(async () => {
                await adminClient.query(crudCreateDocument);
            }, 'You are not currently authorized to perform this action'),
        );

        it(
            'CRUD read permission',
            assertThrowsWithMessage(async () => {
                await adminClient.query(crudReadDocument);
            }, 'You are not currently authorized to perform this action'),
        );

        it(
            'CRUD update permission',
            assertThrowsWithMessage(async () => {
                await adminClient.query(crudUpdateDocument);
            }, 'You are not currently authorized to perform this action'),
        );

        it(
            'CRUD delete permission',
            assertThrowsWithMessage(async () => {
                await adminClient.query(crudDeleteDocument);
            }, 'You are not currently authorized to perform this action'),
        );
    });

    describe('adding permissions enables access', () => {
        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            await adminClient.query(updateRoleDocument, {
                input: {
                    id: testRole.id,
                    permissions: [
                        sync.Permission,
                        wishlist.Create,
                        wishlist.Read,
                        wishlist.Update,
                        wishlist.Delete,
                    ],
                },
            });

            await adminClient.asUserWithCredentials(testAdmin.emailAddress, 'test');
        });

        it('single permission', async () => {
            const { syncWishlist } = await adminClient.query(syncCustomPermissionsDocument);
            expect(syncWishlist).toBe(true);
        });

        it('CRUD create permission', async () => {
            const { createWishlist } = await adminClient.query(crudCreateDocument);
            expect(createWishlist).toBe(true);
        });

        it('CRUD read permission', async () => {
            // eslint-disable-next-line no-shadow,@typescript-eslint/no-shadow
            const { wishlist } = await adminClient.query(crudReadDocument);
            expect(wishlist).toBe(true);
        });

        it('CRUD update permission', async () => {
            const { updateWishlist } = await adminClient.query(crudUpdateDocument);
            expect(updateWishlist).toBe(true);
        });

        it('CRUD delete permission', async () => {
            const { deleteWishlist } = await adminClient.query(crudDeleteDocument);
            expect(deleteWishlist).toBe(true);
        });
    });
});
