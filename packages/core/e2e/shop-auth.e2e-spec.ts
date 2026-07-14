/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { OnModuleInit } from '@nestjs/common';
import { ErrorCode, RegisterCustomerInput } from '@vendure/common/lib/generated-shop-types';
import { HistoryEntryType } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import {
    AccountRegistrationEvent,
    EventBus,
    EventBusModule,
    IdentifierChangeEvent,
    IdentifierChangeRequestEvent,
    PasswordResetEvent,
    PasswordValidationStrategy,
    RequestContext,
    VendurePlugin,
    mergeConfig,
} from '@vendure/core';
import { ErrorResultGuard, createErrorResultGuard, createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { Mock, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { PasswordValidationError } from '../src/common/error/generated-graphql-shop-errors';

import { FragmentOf, ResultOf } from './graphql/graphql-admin';
import {
    MeDocument,
    getCustomerDocument,
    getCustomerHistoryDocument,
    getCustomerListDocument,
} from './graphql/shared-definitions';
import {
    currentUserFragment,
    getActiveCustomerDocument,
    refreshTokenDocument,
    registerAccountDocument,
    requestPasswordResetDocument,
    requestUpdateEmailAddressDocument,
    resetPasswordDocument,
    updateEmailAddressDocument,
    verifyEmailDocument,
} from './graphql/shop-definitions';

let sendEmailFn: Mock;

/**
 * This mock plugin simulates an EmailPlugin which would send emails
 * on the registration & password reset events.
 */
@VendurePlugin({
    imports: [EventBusModule],
})
class TestEmailPlugin implements OnModuleInit {
    constructor(private eventBus: EventBus) {}

    onModuleInit() {
        this.eventBus.ofType(AccountRegistrationEvent).subscribe(event => {
            sendEmailFn?.(event);
        });
        this.eventBus.ofType(PasswordResetEvent).subscribe(event => {
            sendEmailFn?.(event);
        });
        this.eventBus.ofType(IdentifierChangeRequestEvent).subscribe(event => {
            sendEmailFn?.(event);
        });
        this.eventBus.ofType(IdentifierChangeEvent).subscribe(event => {
            sendEmailFn?.(event);
        });
    }
}

const successErrorGuard: ErrorResultGuard<{ success: boolean }> = createErrorResultGuard(
    input => input.success != null,
);

type CurrentUserShopFragment = FragmentOf<typeof currentUserFragment>;

const currentUserErrorGuard: ErrorResultGuard<CurrentUserShopFragment> = createErrorResultGuard(
    input => input.identifier != null,
);

class TestPasswordValidationStrategy implements PasswordValidationStrategy {
    validate(_: RequestContext, password: string): boolean | string {
        if (password === 'test') {
            // allow the default seed data password
            return true;
        }
        if (password.length < 8) {
            return 'Password must be more than 8 characters';
        }
        if (password === '12345678') {
            return "Don't use 12345678!";
        }
        return true;
    }
}

describe('Shop auth & accounts', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TestEmailPlugin as any],
            authOptions: {
                passwordValidationStrategy: new TestPasswordValidationStrategy(),
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('customer account creation with deferred password', () => {
        const password = 'password';
        const emailAddress = 'test1@test.com';
        let verificationToken: string;
        let newCustomerId: string;

        beforeEach(() => {
            sendEmailFn = vi.fn();
        });

        it('does not return error result on email address conflict', async () => {
            // To prevent account enumeration attacks
            const { customers } = await adminClient.query(getCustomerListDocument);
            const input: RegisterCustomerInput = {
                firstName: 'Duplicate',
                lastName: 'Person',
                phoneNumber: '123456',
                emailAddress: customers.items[0].emailAddress,
            };
            const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
                input,
            });
            successErrorGuard.assertSuccess(registerCustomerAccount);
        });

        it('register a new account without password', async () => {
            const verificationTokenPromise = getVerificationTokenPromise();
            const input: RegisterCustomerInput = {
                firstName: 'Sean',
                lastName: 'Tester',
                phoneNumber: '123456',
                emailAddress,
            };
            const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
                input,
            });
            successErrorGuard.assertSuccess(registerCustomerAccount);

            verificationToken = await verificationTokenPromise;

            expect(registerCustomerAccount.success).toBe(true);
            expect(sendEmailFn).toHaveBeenCalled();
            expect(verificationToken).toBeDefined();

            const { customers } = await adminClient.query(getCustomerListDocument, {
                options: {
                    filter: {
                        emailAddress: {
                            eq: emailAddress,
                        },
                    },
                },
            });

            expect(
                pick(customers.items[0], ['firstName', 'lastName', 'emailAddress', 'phoneNumber']),
            ).toEqual(input);
        });

        it('issues a new token if attempting to register a second time', async () => {
            const sendEmail = new Promise<string>(resolve => {
                sendEmailFn.mockImplementation((event: AccountRegistrationEvent) => {
                    resolve(event.user.getNativeAuthenticationMethod().verificationToken!);
                });
            });
            const input: RegisterCustomerInput = {
                firstName: 'Sean',
                lastName: 'Tester',
                emailAddress,
            };
            const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
                input,
            });
            successErrorGuard.assertSuccess(registerCustomerAccount);

            const newVerificationToken = await sendEmail;

            expect(registerCustomerAccount.success).toBe(true);
            expect(sendEmailFn).toHaveBeenCalled();
            expect(newVerificationToken).not.toBe(verificationToken);

            verificationToken = newVerificationToken;
        });

        it('refreshCustomerVerification issues a new token', async () => {
            const sendEmail = new Promise<string>(resolve => {
                sendEmailFn.mockImplementation((event: AccountRegistrationEvent) => {
                    resolve(event.user.getNativeAuthenticationMethod().verificationToken!);
                });
            });
            const { refreshCustomerVerification } = await shopClient.query(refreshTokenDocument, {
                emailAddress,
            });
            successErrorGuard.assertSuccess(refreshCustomerVerification);
            const newVerificationToken = await sendEmail;

            expect(refreshCustomerVerification.success).toBe(true);
            expect(sendEmailFn).toHaveBeenCalled();
            expect(newVerificationToken).not.toBe(verificationToken);

            verificationToken = newVerificationToken;
        });

        it('refreshCustomerVerification does nothing with an unrecognized emailAddress', async () => {
            const { refreshCustomerVerification } = await shopClient.query(refreshTokenDocument, {
                emailAddress: 'never-been-registered@test.com',
            });
            successErrorGuard.assertSuccess(refreshCustomerVerification);
            await waitForSendEmailFn();

            expect(refreshCustomerVerification.success).toBe(true);
            expect(sendEmailFn).not.toHaveBeenCalled();
        });

        it('login fails before verification', async () => {
            const result = await shopClient.asUserWithCredentials(emailAddress, '');
            expect(result.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
        });

        it('verification fails with wrong token', async () => {
            const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
                password,
                token: 'bad-token',
            });
            currentUserErrorGuard.assertErrorResult(verifyCustomerAccount);

            expect(verifyCustomerAccount.message).toBe('Verification token not recognized');
            expect(verifyCustomerAccount.errorCode).toBe(ErrorCode.VERIFICATION_TOKEN_INVALID_ERROR);
        });

        it('verification fails with no password', async () => {
            const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
                token: verificationToken,
            });
            currentUserErrorGuard.assertErrorResult(verifyCustomerAccount);

            expect(verifyCustomerAccount.message).toBe('A password must be provided.');
            expect(verifyCustomerAccount.errorCode).toBe(ErrorCode.MISSING_PASSWORD_ERROR);
        });

        it('verification fails with invalid password', async () => {
            const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
                token: verificationToken,
                password: '2short',
            });
            currentUserErrorGuard.assertErrorResult(verifyCustomerAccount);

            expect(verifyCustomerAccount.message).toBe('Password is invalid');
            expect((verifyCustomerAccount as PasswordValidationError).validationErrorMessage).toBe(
                'Password must be more than 8 characters',
            );
            expect(verifyCustomerAccount.errorCode).toBe(ErrorCode.PASSWORD_VALIDATION_ERROR);
        });

        it('verification succeeds with password and correct token', async () => {
            const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
                password,
                token: verificationToken,
            });
            currentUserErrorGuard.assertSuccess(verifyCustomerAccount);

            expect(verifyCustomerAccount.identifier).toBe('test1@test.com');
            const { activeCustomer } = await shopClient.query(getActiveCustomerDocument);
            newCustomerId = activeCustomer!.id;
        });

        it('registration silently fails if attempting to register an email already verified', async () => {
            const input: RegisterCustomerInput = {
                firstName: 'Dodgy',
                lastName: 'Hacker',
                emailAddress,
            };
            const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
                input,
            });
            successErrorGuard.assertSuccess(registerCustomerAccount);

            await waitForSendEmailFn();
            expect(registerCustomerAccount.success).toBe(true);
            expect(sendEmailFn).not.toHaveBeenCalled();
        });

        it('verification fails if attempted a second time', async () => {
            const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
                password,
                token: verificationToken,
            });
            currentUserErrorGuard.assertErrorResult(verifyCustomerAccount);

            expect(verifyCustomerAccount.message).toBe('Verification token not recognized');
            expect(verifyCustomerAccount.errorCode).toBe(ErrorCode.VERIFICATION_TOKEN_INVALID_ERROR);
        });

        it('customer history contains entries for registration & verification', async () => {
            const { customer } = await adminClient.query(getCustomerHistoryDocument, {
                id: newCustomerId,
            });

            expect(customer?.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_REGISTERED,
                    data: {
                        strategy: 'native',
                    },
                },
                {
                    // second entry because we register twice above
                    type: HistoryEntryType.CUSTOMER_REGISTERED,
                    data: {
                        strategy: 'native',
                    },
                },
                {
                    type: HistoryEntryType.CUSTOMER_VERIFIED,
                    data: {
                        strategy: 'native',
                    },
                },
            ]);
        });
    });

    describe('customer account creation with up-front password', () => {
        const password = 'password';
        const emailAddress = 'test2@test.com';
        let verificationToken: string;

        it('registerCustomerAccount fails with invalid password', async () => {
            const input: RegisterCustomerInput = {
                firstName: 'Lu',
                lastName: 'Tester',
                phoneNumber: '443324',
                emailAddress,
                password: '12345678',
            };
            const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
                input,
            });
            successErrorGuard.assertErrorResult(registerCustomerAccount);
            expect(registerCustomerAccount.errorCode).toBe(ErrorCode.PASSWORD_VALIDATION_ERROR);
            expect(registerCustomerAccount.message).toBe('Password is invalid');
            expect((registerCustomerAccount as PasswordValidationError).validationErrorMessage).toBe(
                "Don't use 12345678!",
            );
        });

        it('register a new account with password', async () => {
            const verificationTokenPromise = getVerificationTokenPromise();
            const input: RegisterCustomerInput = {
                firstName: 'Lu',
                lastName: 'Tester',
                phoneNumber: '443324',
                emailAddress,
                password,
            };
            const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
                input,
            });
            successErrorGuard.assertSuccess(registerCustomerAccount);

            verificationToken = await verificationTokenPromise;

            expect(registerCustomerAccount.success).toBe(true);
            expect(sendEmailFn).toHaveBeenCalled();
            expect(verificationToken).toBeDefined();

            const { customers } = await adminClient.query(getCustomerListDocument, {
                options: {
                    filter: {
                        emailAddress: {
                            eq: emailAddress,
                        },
                    },
                },
            });

            expect(
                pick(customers.items[0], ['firstName', 'lastName', 'emailAddress', 'phoneNumber']),
            ).toEqual(pick(input, ['firstName', 'lastName', 'emailAddress', 'phoneNumber']));
        });

        it('login fails before verification', async () => {
            const result = await shopClient.asUserWithCredentials(emailAddress, password);
            expect(result.errorCode).toBe(ErrorCode.NOT_VERIFIED_ERROR);
            expect(result.message).toBe('Please verify this email address before logging in');
        });

        it('verification fails with password', async () => {
            const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
                token: verificationToken,
                password: 'new password',
            });
            currentUserErrorGuard.assertErrorResult(verifyCustomerAccount);

            expect(verifyCustomerAccount.message).toBe('A password has already been set during registration');
            expect(verifyCustomerAccount.errorCode).toBe(ErrorCode.PASSWORD_ALREADY_SET_ERROR);
        });

        it('verification succeeds with no password and correct token', async () => {
            const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
                token: verificationToken,
            });
            currentUserErrorGuard.assertSuccess(verifyCustomerAccount);

            expect(verifyCustomerAccount.identifier).toBe('test2@test.com');
            await shopClient.query(getActiveCustomerDocument);
        });
    });

    describe('password reset', () => {
        let passwordResetToken: string;
        let customer: NonNullable<ResultOf<typeof getCustomerDocument>['customer']>;

        beforeAll(async () => {
            const result = await adminClient.query(getCustomerDocument, {
                id: 'T_1',
            });
            customer = result.customer!;
        });

        beforeEach(() => {
            sendEmailFn = vi.fn();
        });

        it('requestPasswordReset silently fails with invalid identifier', async () => {
            const { requestPasswordReset } = await shopClient.query(requestPasswordResetDocument, {
                identifier: 'invalid-identifier',
            });
            successErrorGuard.assertSuccess(requestPasswordReset);

            await waitForSendEmailFn();
            expect(requestPasswordReset.success).toBe(true);
            expect(sendEmailFn).not.toHaveBeenCalled();
            expect(passwordResetToken).not.toBeDefined();
        });

        it('requestPasswordReset sends reset token', async () => {
            const passwordResetTokenPromise = getPasswordResetTokenPromise();
            const { requestPasswordReset } = await shopClient.query(requestPasswordResetDocument, {
                identifier: customer!.emailAddress,
            });
            successErrorGuard.assertSuccess(requestPasswordReset);

            passwordResetToken = await passwordResetTokenPromise;

            expect(requestPasswordReset.success).toBe(true);
            expect(sendEmailFn).toHaveBeenCalled();
            expect(passwordResetToken).toBeDefined();
        });

        it('resetPassword returns error result with wrong token', async () => {
            const { resetPassword } = await shopClient.query(resetPasswordDocument, {
                password: 'newPassword',
                token: 'bad-token',
            });
            currentUserErrorGuard.assertErrorResult(resetPassword);

            expect(resetPassword.message).toBe('Password reset token not recognized');
            expect(resetPassword.errorCode).toBe(ErrorCode.PASSWORD_RESET_TOKEN_INVALID_ERROR);
        });

        it('resetPassword fails with invalid password', async () => {
            const { resetPassword } = await shopClient.query(resetPasswordDocument, {
                token: passwordResetToken,
                password: '2short',
            });
            currentUserErrorGuard.assertErrorResult(resetPassword);

            expect(resetPassword.message).toBe('Password is invalid');
            expect((resetPassword as PasswordValidationError).validationErrorMessage).toBe(
                'Password must be more than 8 characters',
            );
            expect(resetPassword.errorCode).toBe(ErrorCode.PASSWORD_VALIDATION_ERROR);
        });

        it('resetPassword works with valid token', async () => {
            const { resetPassword } = await shopClient.query(resetPasswordDocument, {
                token: passwordResetToken,
                password: 'newPassword',
            });
            currentUserErrorGuard.assertSuccess(resetPassword);

            expect(resetPassword.identifier).toBe(customer!.emailAddress);

            const loginResult = await shopClient.asUserWithCredentials(customer!.emailAddress, 'newPassword');
            expect(loginResult.identifier).toBe(customer!.emailAddress);
        });

        it('customer history for password reset', async () => {
            const result = await adminClient.query(getCustomerHistoryDocument, {
                id: customer!.id,
                options: {
                    // skip CUSTOMER_ADDRESS_CREATED entry
                    skip: 3,
                },
            });

            expect(result.customer?.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_PASSWORD_RESET_REQUESTED,
                    data: {},
                },
                {
                    type: HistoryEntryType.CUSTOMER_PASSWORD_RESET_VERIFIED,
                    data: {},
                },
            ]);
        });
    });

    // https://github.com/vendurehq/vendure/issues/1659
    describe('password reset before verification', () => {
        const emailAddress = 'test3@test.com';
        let passwordResetToken: string;
        let newCustomerId: string;

        beforeEach(() => {
            sendEmailFn = vi.fn();
        });

        it('register a new account without password', async () => {
            const input: RegisterCustomerInput = {
                firstName: 'Bobby',
                lastName: 'Tester',
                phoneNumber: '123456',
                emailAddress,
            };
            await shopClient.query(registerAccountDocument, { input });

            const { customers } = await adminClient.query(getCustomerListDocument, {
                options: {
                    filter: {
                        emailAddress: { eq: emailAddress },
                    },
                },
            });

            expect(customers.items[0].user?.verified).toBe(false);
            newCustomerId = customers.items[0].id;
        });

        it('requestPasswordReset', async () => {
            const passwordResetTokenPromise = getPasswordResetTokenPromise();
            const { requestPasswordReset } = await shopClient.query(requestPasswordResetDocument, {
                identifier: emailAddress,
            });
            successErrorGuard.assertSuccess(requestPasswordReset);

            await waitForSendEmailFn();
            passwordResetToken = await passwordResetTokenPromise;
            expect(requestPasswordReset.success).toBe(true);
            expect(sendEmailFn).toHaveBeenCalled();
            expect(passwordResetToken).toBeDefined();
        });

        it('resetPassword also performs verification', async () => {
            const { resetPassword } = await shopClient.query(resetPasswordDocument, {
                token: passwordResetToken,
                password: 'newPassword',
            });
            currentUserErrorGuard.assertSuccess(resetPassword);

            expect(resetPassword.identifier).toBe(emailAddress);
            const { customer } = await adminClient.query(getCustomerDocument, {
                id: newCustomerId,
            });

            expect(customer?.user?.verified).toBe(true);
        });

        it('can log in with new password', async () => {
            const loginResult = await shopClient.asUserWithCredentials(emailAddress, 'newPassword');
            expect(loginResult.identifier).toBe(emailAddress);
        });
    });

    describe('updating emailAddress', () => {
        let emailUpdateToken: string;
        let customer: NonNullable<ResultOf<typeof getCustomerDocument>['customer']>;
        const NEW_EMAIL_ADDRESS = 'new@address.com';
        const PASSWORD = 'newPassword';

        beforeAll(async () => {
            const result = await adminClient.query(getCustomerDocument, {
                id: 'T_1',
            });
            customer = result.customer!;
        });

        beforeEach(() => {
            sendEmailFn = vi.fn();
        });

        it('throws if not logged in', async () => {
            try {
                await shopClient.asAnonymousUser();
                await shopClient.query(requestUpdateEmailAddressDocument, {
                    password: PASSWORD,
                    newEmailAddress: NEW_EMAIL_ADDRESS,
                });
                fail('should have thrown');
            } catch (err: any) {
                expect(getErrorCode(err)).toBe('FORBIDDEN');
            }
        });

        it('return error result if password is incorrect', async () => {
            await shopClient.asUserWithCredentials(customer!.emailAddress, PASSWORD);
            const { requestUpdateCustomerEmailAddress } = await shopClient.query(
                requestUpdateEmailAddressDocument,
                {
                    password: 'bad password',
                    newEmailAddress: NEW_EMAIL_ADDRESS,
                },
            );
            successErrorGuard.assertErrorResult(requestUpdateCustomerEmailAddress);

            expect(requestUpdateCustomerEmailAddress.message).toBe('The provided credentials are invalid');
            expect(requestUpdateCustomerEmailAddress.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
        });

        it('return error result email address already in use', async () => {
            await shopClient.asUserWithCredentials(customer!.emailAddress, PASSWORD);
            const result = await adminClient.query(getCustomerDocument, {
                id: 'T_2',
            });
            const otherCustomer = result.customer!;

            const { requestUpdateCustomerEmailAddress } = await shopClient.query(
                requestUpdateEmailAddressDocument,
                {
                    password: PASSWORD,
                    newEmailAddress: otherCustomer.emailAddress,
                },
            );
            successErrorGuard.assertErrorResult(requestUpdateCustomerEmailAddress);

            expect(requestUpdateCustomerEmailAddress.message).toBe('The email address is not available.');
            expect(requestUpdateCustomerEmailAddress.errorCode).toBe(ErrorCode.EMAIL_ADDRESS_CONFLICT_ERROR);
        });

        it('triggers event with token', async () => {
            await shopClient.asUserWithCredentials(customer!.emailAddress, PASSWORD);
            const emailUpdateTokenPromise = getEmailUpdateTokenPromise();

            await shopClient.query(requestUpdateEmailAddressDocument, {
                password: PASSWORD,
                newEmailAddress: NEW_EMAIL_ADDRESS,
            });

            const { identifierChangeToken, pendingIdentifier } = await emailUpdateTokenPromise;
            emailUpdateToken = identifierChangeToken!;

            expect(pendingIdentifier).toBe(NEW_EMAIL_ADDRESS);
            expect(emailUpdateToken).toBeTruthy();
        });

        it('cannot login with new email address before verification', async () => {
            const result = await shopClient.asUserWithCredentials(NEW_EMAIL_ADDRESS, PASSWORD);

            expect(result.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
        });

        it('return error result for bad token', async () => {
            const { updateCustomerEmailAddress } = await shopClient.query(updateEmailAddressDocument, {
                token: 'bad token',
            });
            successErrorGuard.assertErrorResult(updateCustomerEmailAddress);

            expect(updateCustomerEmailAddress.message).toBe('Identifier change token not recognized');
            expect(updateCustomerEmailAddress.errorCode).toBe(
                ErrorCode.IDENTIFIER_CHANGE_TOKEN_INVALID_ERROR,
            );
        });

        it('verify the new email address', async () => {
            const { updateCustomerEmailAddress } = await shopClient.query(updateEmailAddressDocument, {
                token: emailUpdateToken,
            });
            successErrorGuard.assertSuccess(updateCustomerEmailAddress);

            expect(updateCustomerEmailAddress.success).toBe(true);

            // Allow for occasional race condition where the event does not
            // publish before the assertions are made.
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(sendEmailFn).toHaveBeenCalled();
            expect(sendEmailFn.mock.calls[0][0] instanceof IdentifierChangeEvent).toBe(true);
        });

        it('can login with new email address after verification', async () => {
            await shopClient.asUserWithCredentials(NEW_EMAIL_ADDRESS, PASSWORD);
            const { activeCustomer } = await shopClient.query(getActiveCustomerDocument);
            expect(activeCustomer!.id).toBe(customer!.id);
            expect(activeCustomer!.emailAddress).toBe(NEW_EMAIL_ADDRESS);
        });

        it('cannot login with old email address after verification', async () => {
            const result = await shopClient.asUserWithCredentials(customer!.emailAddress, PASSWORD);

            expect(result.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
        });

        it('customer history for email update', async () => {
            const result = await adminClient.query(getCustomerHistoryDocument, {
                id: customer!.id,
                options: {
                    skip: 5,
                },
            });

            expect(result.customer?.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_EMAIL_UPDATE_REQUESTED,
                    data: {
                        newEmailAddress: 'new@address.com',
                        oldEmailAddress: 'hayden.zieme12@hotmail.com',
                    },
                },
                {
                    type: HistoryEntryType.CUSTOMER_EMAIL_UPDATE_VERIFIED,
                    data: {
                        newEmailAddress: 'new@address.com',
                        oldEmailAddress: 'hayden.zieme12@hotmail.com',
                    },
                },
            ]);
        });
    });

    function getErrorCode(err: any): string {
        return err.response.errors[0].extensions.code;
    }

    /**
     * A "sleep" function which allows the sendEmailFn time to get called.
     */
    function waitForSendEmailFn() {
        return new Promise(resolve => setTimeout(resolve, 10));
    }
});

describe('Expiring tokens', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TestEmailPlugin as any],
            authOptions: {
                verificationTokenDuration: '1ms',
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    beforeEach(() => {
        sendEmailFn = vi.fn();
    });

    afterAll(async () => {
        await server.destroy();
    });

    it('attempting to verify after token has expired throws', async () => {
        const verificationTokenPromise = getVerificationTokenPromise();
        const input: RegisterCustomerInput = {
            firstName: 'Barry',
            lastName: 'Wallace',
            emailAddress: 'barry.wallace@test.com',
        };
        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input,
        });
        successErrorGuard.assertSuccess(registerCustomerAccount);

        const verificationToken = await verificationTokenPromise;

        expect(registerCustomerAccount.success).toBe(true);
        expect(sendEmailFn).toHaveBeenCalledTimes(1);
        expect(verificationToken).toBeDefined();

        await new Promise(resolve => setTimeout(resolve, 3));

        const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
            password: 'test',
            token: verificationToken,
        });
        currentUserErrorGuard.assertErrorResult(verifyCustomerAccount);

        expect(verifyCustomerAccount.message).toBe(
            'Verification token has expired. Use refreshCustomerVerification to send a new token.',
        );
        expect(verifyCustomerAccount.errorCode).toBe(ErrorCode.VERIFICATION_TOKEN_EXPIRED_ERROR);
    });

    it('attempting to reset password after token has expired returns error result', async () => {
        const { customer } = await adminClient.query(getCustomerDocument, {
            id: 'T_1',
        });

        const passwordResetTokenPromise = getPasswordResetTokenPromise();
        const { requestPasswordReset } = await shopClient.query(requestPasswordResetDocument, {
            identifier: customer!.emailAddress,
        });
        successErrorGuard.assertSuccess(requestPasswordReset);

        const passwordResetToken = await passwordResetTokenPromise;

        expect(requestPasswordReset.success).toBe(true);
        expect(sendEmailFn).toHaveBeenCalledTimes(1);
        expect(passwordResetToken).toBeDefined();

        await new Promise(resolve => setTimeout(resolve, 3));

        const { resetPassword } = await shopClient.query(resetPasswordDocument, {
            password: 'test',
            token: passwordResetToken,
        });

        currentUserErrorGuard.assertErrorResult(resetPassword);

        expect(resetPassword.message).toBe('Password reset token has expired');
        expect(resetPassword.errorCode).toBe(ErrorCode.PASSWORD_RESET_TOKEN_EXPIRED_ERROR);
    });
});

describe('Registration without email verification', () => {
    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TestEmailPlugin as any],
            authOptions: {
                requireVerification: false,
            },
        }),
    );
    const userEmailAddress = 'glen.beardsley@test.com';

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    beforeEach(() => {
        sendEmailFn = vi.fn();
    });

    afterAll(async () => {
        await server.destroy();
    });

    it('Returns error result if no password is provided', async () => {
        const input: RegisterCustomerInput = {
            firstName: 'Glen',
            lastName: 'Beardsley',
            emailAddress: userEmailAddress,
        };
        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input,
        });
        successErrorGuard.assertErrorResult(registerCustomerAccount);

        expect(registerCustomerAccount.message).toBe('A password must be provided.');
        expect(registerCustomerAccount.errorCode).toBe(ErrorCode.MISSING_PASSWORD_ERROR);
    });

    it('register a new account with password', async () => {
        const input: RegisterCustomerInput = {
            firstName: 'Glen',
            lastName: 'Beardsley',
            emailAddress: userEmailAddress,
            password: 'test',
        };
        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input,
        });
        successErrorGuard.assertSuccess(registerCustomerAccount);

        expect(registerCustomerAccount.success).toBe(true);
        expect(sendEmailFn).not.toHaveBeenCalled();
    });

    it('can login after registering', async () => {
        await shopClient.asUserWithCredentials(userEmailAddress, 'test');

        const result = await shopClient.query(MeDocument, {});
        expect(result.me?.identifier).toBe(userEmailAddress);
    });

    it('can login case insensitive', async () => {
        await shopClient.asUserWithCredentials(userEmailAddress.toUpperCase(), 'test');

        const result = await shopClient.query(MeDocument, {});
        expect(result.me?.identifier).toBe(userEmailAddress);
    });

    it('normalizes customer & user email addresses', async () => {
        const input: RegisterCustomerInput = {
            firstName: 'Bobbington',
            lastName: 'Jarrolds',
            emailAddress: 'BOBBINGTON.J@Test.com',
            password: 'test',
        };
        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input,
        });
        successErrorGuard.assertSuccess(registerCustomerAccount);

        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: {
                filter: {
                    firstName: { eq: 'Bobbington' },
                },
            },
        });

        expect(customers.items[0].emailAddress).toBe('bobbington.j@test.com');
        expect(customers.items[0].user?.identifier).toBe('bobbington.j@test.com');
    });

    it('registering with same email address with different casing does not create new user', async () => {
        const input: RegisterCustomerInput = {
            firstName: 'Glen',
            lastName: 'Beardsley',
            emailAddress: userEmailAddress.toUpperCase(),
            password: 'test',
        };
        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input,
        });
        successErrorGuard.assertSuccess(registerCustomerAccount);

        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: {
                filter: {
                    firstName: { eq: 'Glen' },
                },
            },
        });

        expect(customers.items[0].emailAddress).toBe(userEmailAddress);
        expect(customers.items[0].user?.identifier).toBe(userEmailAddress);
    });
});

describe('Updating email address without email verification', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TestEmailPlugin as any],
            authOptions: {
                requireVerification: false,
            },
        }),
    );
    let customer: NonNullable<ResultOf<typeof getCustomerDocument>['customer']>;
    const NEW_EMAIL_ADDRESS = 'new@address.com';

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const result = await adminClient.query(getCustomerDocument, {
            id: 'T_1',
        });
        customer = result.customer!;
    }, TEST_SETUP_TIMEOUT_MS);

    beforeEach(() => {
        sendEmailFn = vi.fn();
    });

    afterAll(async () => {
        await server.destroy();
    });

    it('updates email address', async () => {
        await shopClient.asUserWithCredentials(customer!.emailAddress, 'test');
        const { requestUpdateCustomerEmailAddress } = await shopClient.query(
            requestUpdateEmailAddressDocument,
            {
                password: 'test',
                newEmailAddress: NEW_EMAIL_ADDRESS,
            },
        );
        successErrorGuard.assertSuccess(requestUpdateCustomerEmailAddress);
        // Attempting to fix flakiness possibly caused by race condition on the event
        // subscriber
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(requestUpdateCustomerEmailAddress.success).toBe(true);
        expect(sendEmailFn).toHaveBeenCalledTimes(1);
        expect(sendEmailFn.mock.calls[0][0] instanceof IdentifierChangeEvent).toBe(true);

        const { activeCustomer } = await shopClient.query(getActiveCustomerDocument);
        expect(activeCustomer!.emailAddress).toBe(NEW_EMAIL_ADDRESS);
    });

    it('normalizes updated email address', async () => {
        await shopClient.asUserWithCredentials(NEW_EMAIL_ADDRESS, 'test');
        const { requestUpdateCustomerEmailAddress } = await shopClient.query(
            requestUpdateEmailAddressDocument,
            {
                password: 'test',
                newEmailAddress: ' Not.Normal@test.com ',
            },
        );
        successErrorGuard.assertSuccess(requestUpdateCustomerEmailAddress);
        // Attempting to fix flakiness possibly caused by race condition on the event
        // subscriber
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(requestUpdateCustomerEmailAddress.success).toBe(true);
        expect(sendEmailFn).toHaveBeenCalledTimes(1);
        expect(sendEmailFn.mock.calls[0][0] instanceof IdentifierChangeEvent).toBe(true);

        const { activeCustomer } = await shopClient.query(getActiveCustomerDocument);
        expect(activeCustomer!.emailAddress).toBe('not.normal@test.com');
    });
});

function getVerificationTokenPromise(): Promise<string> {
    return new Promise<any>(resolve => {
        sendEmailFn.mockImplementation((event: AccountRegistrationEvent) => {
            resolve(event.user.getNativeAuthenticationMethod().verificationToken);
        });
    });
}

function getPasswordResetTokenPromise(): Promise<string> {
    return new Promise<any>(resolve => {
        sendEmailFn.mockImplementation((event: PasswordResetEvent) => {
            resolve(event.user.getNativeAuthenticationMethod().passwordResetToken);
        });
    });
}

function getEmailUpdateTokenPromise(): Promise<{
    identifierChangeToken: string | null;
    pendingIdentifier: string | null;
}> {
    return new Promise(resolve => {
        sendEmailFn.mockImplementation((event: IdentifierChangeRequestEvent) => {
            resolve(
                pick(event.user.getNativeAuthenticationMethod(), [
                    'identifierChangeToken',
                    'pendingIdentifier',
                ]),
            );
        });
    });
}
