import { DeletionResult } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_IDENTIFIER } from '@vendure/common/lib/shared-constants';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import { fail } from 'assert';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { administratorFragment, currentUserFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import {
    attemptLoginDocument,
    createAdministratorDocument,
    deleteAdministratorDocument,
    getActiveAdministratorDocument,
    getAdministratorDocument,
    getAdministratorsDocument,
    updateActiveAdministratorDocument,
    updateAdministratorDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

describe('Administrator resolver', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());
    let createdAdmin: FragmentOf<typeof administratorFragment>;

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

    it('administrators', async () => {
        const result = await adminClient.query(getAdministratorsDocument);
        expect(result.administrators.items.length).toBe(1);
        expect(result.administrators.totalItems).toBe(1);
    });

    it('createAdministrator', async () => {
        const result = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: 'test@test.com',
                firstName: 'First',
                lastName: 'Last',
                password: 'password',
                roleIds: ['1'],
            },
        });

        createdAdmin = result.createAdministrator;
        expect(createdAdmin).toMatchSnapshot();
    });

    it('administrator', async () => {
        const result = await adminClient.query(getAdministratorDocument, {
            id: createdAdmin.id,
        });
        expect(result.administrator).toEqual(createdAdmin);
    });

    it('updateAdministrator', async () => {
        const result = await adminClient.query(updateAdministratorDocument, {
            input: {
                id: createdAdmin.id,
                emailAddress: 'new-email',
                firstName: 'new first',
                lastName: 'new last',
                password: 'new password',
                roleIds: ['2'],
            },
        });
        expect(result.updateAdministrator).toMatchSnapshot();
    });

    it('updateAdministrator works with partial input', async () => {
        const result = await adminClient.query(updateAdministratorDocument, {
            input: {
                id: createdAdmin.id,
                emailAddress: 'newest-email',
            },
        });
        expect(result.updateAdministrator.emailAddress).toBe('newest-email');
        expect(result.updateAdministrator.firstName).toBe('new first');
        expect(result.updateAdministrator.lastName).toBe('new last');
    });

    it(
        'updateAdministrator throws with invalid roleId',
        assertThrowsWithMessage(
            () =>
                adminClient.query(updateAdministratorDocument, {
                    input: {
                        id: createdAdmin.id,
                        emailAddress: 'new-email',
                        firstName: 'new first',
                        lastName: 'new last',
                        password: 'new password',
                        roleIds: ['999'],
                    },
                }),
            'No Role with the id "999" could be found',
        ),
    );

    it('deleteAdministrator', async () => {
        const { administrators: before } = await adminClient.query(getAdministratorsDocument);
        expect(before.totalItems).toBe(2);

        const { deleteAdministrator } = await adminClient.query(deleteAdministratorDocument, {
            id: createdAdmin.id,
        });

        expect(deleteAdministrator.result).toBe(DeletionResult.DELETED);

        const { administrators: after } = await adminClient.query(getAdministratorsDocument);
        expect(after.totalItems).toBe(1);
    });

    it('cannot delete sole SuperAdmin', async () => {
        const { administrators: before } = await adminClient.query(getAdministratorsDocument);
        expect(before.totalItems).toBe(1);
        expect(before.items[0].emailAddress).toBe('superadmin');

        try {
            await adminClient.query(deleteAdministratorDocument, {
                id: before.items[0].id,
            });
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toBe('The sole SuperAdmin cannot be deleted');
        }

        const { administrators: after } = await adminClient.query(getAdministratorsDocument);
        expect(after.totalItems).toBe(1);
    });

    it(
        'cannot remove SuperAdmin role from sole SuperAdmin',
        assertThrowsWithMessage(async () => {
            await adminClient.query(updateAdministratorDocument, {
                input: {
                    id: 'T_1',
                    roleIds: [],
                },
            });
        }, 'Cannot remove the SuperAdmin role from the sole SuperAdmin'),
    );

    it('cannot query a deleted Administrator', async () => {
        const { administrator } = await adminClient.query(getAdministratorDocument, {
            id: createdAdmin.id,
        });

        expect(administrator).toBeNull();
    });

    // EE-82 — deleted admin cannot log in
    it('deleted admin cannot log in', async () => {
        await adminClient.asAnonymousUser();
        try {
            const { login } = await adminClient.query(attemptLoginDocument, {
                username: 'newest-email',
                password: 'new password',
            });
            expect(login.errorCode).toBe('INVALID_CREDENTIALS_ERROR');
        } finally {
            await adminClient.asSuperAdmin();
        }
    });

    // EE-82 — re-creating admin with same email as a soft-deleted admin should succeed
    it('can create a new admin with same email as a deleted admin', async () => {
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: 'newest-email',
                firstName: 'Recreated',
                lastName: 'Admin',
                password: 'recreated-password',
                roleIds: ['1'],
            },
        });

        expect(createAdministrator.emailAddress).toBe('newest-email');
        expect(createAdministrator.firstName).toBe('Recreated');
    });

    // EE-82 — the new admin with the re-used email can log in
    it('new admin with re-used email can log in', async () => {
        const loginResultGuard: ErrorResultGuard<FragmentOf<typeof currentUserFragment>> =
            createErrorResultGuard(input => !!input.identifier);
        await adminClient.asAnonymousUser();
        try {
            const { login } = await adminClient.query(attemptLoginDocument, {
                username: 'newest-email',
                password: 'recreated-password',
            });
            loginResultGuard.assertSuccess(login);
            expect(login.identifier).toBe('newest-email');
        } finally {
            await adminClient.asSuperAdmin();
        }
    });

    // EE-82 — creating admin with same email as an active admin should throw
    it('cannot create admin with same email as an active admin', async () => {
        try {
            await adminClient.query(createAdministratorDocument, {
                input: {
                    emailAddress: 'newest-email',
                    firstName: 'Duplicate',
                    lastName: 'Admin',
                    password: 'password3',
                    roleIds: ['1'],
                },
            });
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toContain('email');
        }
    });

    it('activeAdministrator', async () => {
        await adminClient.asAnonymousUser();

        const { activeAdministrator: result1 } = await adminClient.query(getActiveAdministratorDocument);
        expect(result1).toBeNull();

        await adminClient.asSuperAdmin();

        const { activeAdministrator: result2 } = await adminClient.query(getActiveAdministratorDocument);
        expect(result2?.emailAddress).toBe(SUPER_ADMIN_USER_IDENTIFIER);
    });

    it('updateActiveAdministrator', async () => {
        const { updateActiveAdministrator } = await adminClient.query(updateActiveAdministratorDocument, {
            input: {
                firstName: 'Thomas',
                lastName: 'Anderson',
                emailAddress: 'neo@metacortex.com',
            },
        });

        expect(updateActiveAdministrator.firstName).toBe('Thomas');
        expect(updateActiveAdministrator.lastName).toBe('Anderson');

        const { activeAdministrator } = await adminClient.query(getActiveAdministratorDocument);

        expect(activeAdministrator?.firstName).toBe('Thomas');
        expect(activeAdministrator?.user.identifier).toBe('neo@metacortex.com');
    });

    it('supports case-sensitive admin identifiers', async () => {
        const loginResultGuard: ErrorResultGuard<FragmentOf<typeof currentUserFragment>> =
            createErrorResultGuard(input => !!input.identifier);
        await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: 'NewAdmin',
                firstName: 'New',
                lastName: 'Admin',
                password: 'password',
                roleIds: ['1'],
            },
        });

        const { login } = await adminClient.query(attemptLoginDocument, {
            username: 'NewAdmin',
            password: 'password',
        });

        loginResultGuard.assertSuccess(login);
        expect(login.identifier).toBe('NewAdmin');
    });
});
