import { OnModuleInit } from '@nestjs/common';
import { DeletionResult, ErrorCode } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_IDENTIFIER } from '@vendure/common/lib/shared-constants';
import {
    AdministratorPasswordResetEvent,
    EventBus,
    EventBusModule,
    mergeConfig,
    PasswordResetEvent,
    VendurePlugin,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import { fail } from 'assert';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { administratorFragment, currentUserFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import {
    attemptLoginDocument,
    createAdministratorDocument,
    createRoleDocument,
    deleteAdministratorDocument,
    getActiveAdministratorAvatarDocument,
    getActiveAdministratorDocument,
    getAdministratorDocument,
    getAdministratorsDocument,
    getAssetDocument,
    getAssetListDocument,
    getCustomerListDocument,
    requestAdminPasswordResetDocument,
    resetAdminPasswordDocument,
    setActiveAdministratorAvatarDocument,
    updateActiveAdministratorDocument,
    updateAdministratorDocument,
} from './graphql/shared-definitions';
import {
    requestPasswordResetDocument,
    resetPasswordDocument,
    currentUserFragment as shopCurrentUserFragment,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

let sendEmailFn: Mock;

/**
 * This mock plugin simulates an EmailPlugin which would send emails
 * on the password reset events.
 */
@VendurePlugin({
    imports: [EventBusModule],
})
class TestEmailPlugin implements OnModuleInit {
    constructor(private eventBus: EventBus) {}

    onModuleInit() {
        this.eventBus.ofType(AdministratorPasswordResetEvent).subscribe(event => {
            sendEmailFn?.(event);
        });
        this.eventBus.ofType(PasswordResetEvent).subscribe(event => {
            sendEmailFn?.(event);
        });
    }
}

describe('Administrator resolver', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TestEmailPlugin as any],
        }),
    );
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

    // https://github.com/vendurehq/vendure/issues/1116
    describe('password reset', () => {
        const testAdminEmail = 'password-reset-test@test.com';
        const newPassword = 'new-password-123';
        let customerEmail: string;
        let passwordResetToken: string;

        const successGuard: ErrorResultGuard<{ success: boolean }> = createErrorResultGuard(
            input => input.success != null,
        );
        const currentUserGuard: ErrorResultGuard<FragmentOf<typeof currentUserFragment>> =
            createErrorResultGuard(input => !!input.identifier);
        const shopCurrentUserGuard: ErrorResultGuard<FragmentOf<typeof shopCurrentUserFragment>> =
            createErrorResultGuard(input => !!input.identifier);

        beforeAll(async () => {
            // The `updateActiveAdministrator` test above changed the superadmin's email address
            await adminClient.asUserWithCredentials('neo@metacortex.com', 'superadmin');
            await adminClient.query(createAdministratorDocument, {
                input: {
                    emailAddress: testAdminEmail,
                    firstName: 'Password',
                    lastName: 'Reset',
                    password: 'initial-password',
                    roleIds: ['1'],
                },
            });
            const { customers } = await adminClient.query(getCustomerListDocument);
            customerEmail = customers.items[0].emailAddress;
        });

        beforeEach(() => {
            sendEmailFn = vi.fn();
        });

        it('requestPasswordReset silently succeeds with unknown email address', async () => {
            const { requestPasswordReset } = await adminClient.query(requestAdminPasswordResetDocument, {
                emailAddress: 'unknown-email@test.com',
            });
            successGuard.assertSuccess(requestPasswordReset);

            await waitForSendEmailFn();
            expect(requestPasswordReset.success).toBe(true);
            expect(sendEmailFn).not.toHaveBeenCalled();
        });

        it('requestPasswordReset silently succeeds with a Customer email address', async () => {
            // Create a pending shop-side reset token for the Customer, so that we can
            // assert that the admin-side request does not overwrite it
            const customerTokenPromise = getPasswordResetTokenPromise();
            await shopClient.query(requestPasswordResetDocument, {
                identifier: customerEmail,
            });
            const customerToken = await customerTokenPromise;
            sendEmailFn = vi.fn();

            const { requestPasswordReset } = await adminClient.query(requestAdminPasswordResetDocument, {
                emailAddress: customerEmail,
            });
            successGuard.assertSuccess(requestPasswordReset);

            await waitForSendEmailFn();
            expect(requestPasswordReset.success).toBe(true);
            expect(sendEmailFn).not.toHaveBeenCalled();

            // The Customer's pending shop-side token is still valid, i.e. the admin-side
            // request did not write a new token onto the Customer's User
            const { resetPassword } = await shopClient.query(resetPasswordDocument, {
                token: customerToken,
                password: 'test',
            });
            shopCurrentUserGuard.assertSuccess(resetPassword);
            expect(resetPassword.identifier).toBe(customerEmail);
        });

        it('requestPasswordReset publishes event with token for an Administrator email address', async () => {
            const passwordResetTokenPromise = getPasswordResetTokenPromise();
            const { requestPasswordReset } = await adminClient.query(requestAdminPasswordResetDocument, {
                emailAddress: testAdminEmail,
            });
            successGuard.assertSuccess(requestPasswordReset);

            passwordResetToken = await passwordResetTokenPromise;

            expect(requestPasswordReset.success).toBe(true);
            expect(sendEmailFn).toHaveBeenCalled();
            expect(sendEmailFn.mock.calls[0][0] instanceof AdministratorPasswordResetEvent).toBe(true);
            expect(passwordResetToken).toBeDefined();
        });

        it('resetPassword returns error result with invalid token', async () => {
            const { resetPassword } = await adminClient.query(resetAdminPasswordDocument, {
                token: 'bad-token',
                password: newPassword,
            });
            currentUserGuard.assertErrorResult(resetPassword);

            expect(resetPassword.errorCode).toBe(ErrorCode.PASSWORD_RESET_TOKEN_INVALID_ERROR);
        });

        it('resetPassword returns error result with a Customer token', async () => {
            const customerTokenPromise = getPasswordResetTokenPromise();
            await shopClient.query(requestPasswordResetDocument, {
                identifier: customerEmail,
            });
            const customerToken = await customerTokenPromise;
            expect(customerToken).toBeDefined();

            const { resetPassword } = await adminClient.query(resetAdminPasswordDocument, {
                token: customerToken,
                password: newPassword,
            });
            currentUserGuard.assertErrorResult(resetPassword);

            expect(resetPassword.errorCode).toBe(ErrorCode.PASSWORD_RESET_TOKEN_INVALID_ERROR);

            // The Customer's password has not been changed
            const customerLogin = await shopClient.asUserWithCredentials(customerEmail, 'test');
            expect(customerLogin.identifier).toBe(customerEmail);
        });

        it('resetPassword returns error result with invalid password', async () => {
            const { resetPassword } = await adminClient.query(resetAdminPasswordDocument, {
                token: passwordResetToken,
                password: 'ab',
            });
            currentUserGuard.assertErrorResult(resetPassword);

            expect(resetPassword.errorCode).toBe(ErrorCode.PASSWORD_VALIDATION_ERROR);
        });

        it('resetPassword works with valid token and signs the Administrator in', async () => {
            const { resetPassword } = await adminClient.query(resetAdminPasswordDocument, {
                token: passwordResetToken,
                password: newPassword,
            });
            currentUserGuard.assertSuccess(resetPassword);

            expect(resetPassword.identifier).toBe(testAdminEmail);

            await adminClient.asAnonymousUser();
            const { login } = await adminClient.query(attemptLoginDocument, {
                username: testAdminEmail,
                password: newPassword,
            });
            currentUserGuard.assertSuccess(login);
            expect(login.identifier).toBe(testAdminEmail);
        });

        it('used token cannot be used again', async () => {
            const { resetPassword } = await adminClient.query(resetAdminPasswordDocument, {
                token: passwordResetToken,
                password: 'another-password',
            });
            currentUserGuard.assertErrorResult(resetPassword);

            expect(resetPassword.errorCode).toBe(ErrorCode.PASSWORD_RESET_TOKEN_INVALID_ERROR);
        });

        function getPasswordResetTokenPromise(): Promise<string> {
            return new Promise<any>(resolve => {
                sendEmailFn.mockImplementation(
                    (event: AdministratorPasswordResetEvent | PasswordResetEvent) => {
                        resolve(event.user.getNativeAuthenticationMethod().passwordResetToken);
                    },
                );
            });
        }

        function waitForSendEmailFn() {
            return new Promise(resolve => setTimeout(resolve, 10));
        }
    });

    describe('active administrator avatar', () => {
        async function loginAsCurrentSuperAdmin() {
            await adminClient.asAnonymousUser();
            const { login } = await adminClient.query(attemptLoginDocument, {
                username: 'neo@metacortex.com',
                password: 'superadmin',
            });
            if (!('identifier' in login)) {
                await adminClient.query(attemptLoginDocument, {
                    username: SUPER_ADMIN_USER_IDENTIFIER,
                    password: 'superadmin',
                });
            }
        }

        it('allows the owner to upload, replace and remove system profile media', async () => {
            await loginAsCurrentSuperAdmin();
            const assetsBefore = await adminClient.query(getAssetListDocument, {});
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'profile-owner',
                    description: 'No asset management permissions',
                    permissions: [],
                },
            });
            await adminClient.query(createAdministratorDocument, {
                input: {
                    emailAddress: 'profile-owner@example.com',
                    firstName: 'Profile',
                    lastName: 'Owner',
                    password: 'profile-owner-password',
                    roleIds: [createRole.id],
                },
            });

            await adminClient.asAnonymousUser();
            await adminClient.query(attemptLoginDocument, {
                username: 'profile-owner@example.com',
                password: 'profile-owner-password',
            });

            const firstUpload = await adminClient.fileUploadMutation({
                mutation: setActiveAdministratorAvatarDocument,
                filePaths: [path.join(__dirname, 'fixtures/assets/pps1.jpg')],
                mapVariables: () => ({ file: null }),
            });
            expect(firstUpload.setActiveAdministratorAvatar.avatar).toMatchObject({
                id: expect.any(String),
                mimeType: 'image/jpeg',
                width: expect.any(Number),
                height: expect.any(Number),
            });
            expect(firstUpload.setActiveAdministratorAvatar.avatar.source).toMatch(/^test-url\//);
            expect(firstUpload.setActiveAdministratorAvatar.avatar.preview).toMatch(/^test-url\//);

            const secondUpload = await adminClient.fileUploadMutation({
                mutation: setActiveAdministratorAvatarDocument,
                filePaths: [path.join(__dirname, 'fixtures/assets/pps2.jpg')],
                mapVariables: () => ({ file: null }),
            });
            expect(secondUpload.setActiveAdministratorAvatar.avatar.source).toContain('pps2.jpg');
            expect(secondUpload.setActiveAdministratorAvatar.avatar.id).not.toBe(
                firstUpload.setActiveAdministratorAvatar.avatar.id,
            );

            const queried = await adminClient.query(getActiveAdministratorAvatarDocument);
            expect(queried.activeAdministrator?.avatar?.source).toContain('pps2.jpg');

            await loginAsCurrentSuperAdmin();
            const assetsWhileAvatarExists = await adminClient.query(getAssetListDocument, {});
            expect(assetsWhileAvatarExists.assets.totalItems).toBe(assetsBefore.assets.totalItems);
            const systemAssetLookup = await adminClient.query(getAssetDocument, {
                id: secondUpload.setActiveAdministratorAvatar.avatar.id,
            });
            expect(systemAssetLookup.asset).toBeNull();

            await adminClient.asAnonymousUser();
            await adminClient.query(attemptLoginDocument, {
                username: 'profile-owner@example.com',
                password: 'profile-owner-password',
            });
            const removed = await adminClient.query(setActiveAdministratorAvatarDocument, { file: null });
            expect(removed.setActiveAdministratorAvatar.avatar).toBeNull();

            await loginAsCurrentSuperAdmin();
            const assetsAfter = await adminClient.query(getAssetListDocument, {});
            expect(assetsAfter.assets.totalItems).toBe(assetsBefore.assets.totalItems);
        });
    });
});
