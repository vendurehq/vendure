/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { OnModuleInit } from '@nestjs/common';
import { ErrorCode, HistoryEntryType } from '@vendure/common/lib/generated-types';
import {
    AccountRegistrationEvent,
    EventBus,
    EventBusModule,
    mergeConfig,
    NativeAuthenticationMethod,
    NativeAuthenticationStrategy,
    PasswordCipher,
    TransactionalConnection,
    User,
    VendurePlugin,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { TestSSOStrategyShop } from './fixtures/test-authentication-strategies';
import { currentUserFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import {
    attemptLoginDocument,
    authenticateDocument,
    getCustomerHistoryDocument,
    getCustomerListDocument,
    getCustomersDocument,
    getCustomerUserAuthDocument,
} from './graphql/shared-definitions';
import {
    registerAccountDocument,
    requestPasswordResetDocument,
    resetPasswordDocument,
    verifyEmailDocument,
} from './graphql/shop-definitions';

// GHSA-wr5h-x3x6-4h23 — an unauthenticated attacker must not be able to take over an SSO-only account
// (external auth, no native password) by "registering" a native password against the victim's email
// and then logging in natively. The planted credential must only ever become usable once whoever
// controls the mailbox completes the verification flow.
//
// These suites live in their own file (rather than alongside the other authentication-strategy tests)
// so that only the two SSO server environments are initialised. The AccountRegistrationEvent assertion
// below relies on event delivery, which is unreliable when several unrelated test servers are created
// and torn down within a single file.

type CurrentUserFragmentType = FragmentOf<typeof currentUserFragment>;
const currentUserGuard: ErrorResultGuard<CurrentUserFragmentType> = createErrorResultGuard(
    input => input.identifier != null,
);
const successGuard: ErrorResultGuard<{ success: boolean }> = createErrorResultGuard(
    input => input.success != null,
);

// Every AccountRegistrationEvent is collected so each suite can find its own by the (unique) victim
// email. A shared mutable spy would race once the second suite's environment is initialised.
const registrationEvents: AccountRegistrationEvent[] = [];

@VendurePlugin({ imports: [EventBusModule] })
class RegistrationEventCollectorPlugin implements OnModuleInit {
    constructor(private eventBus: EventBus) {}

    onModuleInit() {
        this.eventBus.ofType(AccountRegistrationEvent).subscribe(event => {
            registrationEvents.push(event);
        });
    }
}

const ATTACKER_PASSWORD = 'attacker-password-123';
const OWNER_PASSWORD = 'owner-password-456';

function runSsoTakeoverSuite(requireVerification: boolean) {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [RegistrationEventCollectorPlugin as any],
            authOptions: {
                requireVerification,
                shopAuthenticationStrategy: [new NativeAuthenticationStrategy(), new TestSSOStrategyShop()],
            },
        }),
    );

    // Distinct email per mode so the two server environments never share a User row.
    const suffix = requireVerification ? 'rv' : 'norv';
    const victimEmail = `sso-victim-${suffix}@test.com`;
    let victimCustomerId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        // Create the victim as an SSO-only account: verified external identity, no native password.
        const { authenticate } = await shopClient.query(authenticateDocument, {
            input: { test_sso_strategy_shop: { email: victimEmail } },
        });
        currentUserGuard.assertSuccess(authenticate);
        await shopClient.asAnonymousUser();

        const { customers } = await adminClient.query(getCustomersDocument);
        victimCustomerId = customers.items.find(c => c.emailAddress === victimEmail)!.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // Runs first, while the victim is still SSO-only (no native method yet).
    it('an invalid password is rejected the same way as for a non-existent email (no enumeration oracle)', async () => {
        await shopClient.asAnonymousUser();
        const tooShort = 'x'; // below the default password minLength of 4
        const { registerCustomerAccount: existing } = await shopClient.query(registerAccountDocument, {
            input: { emailAddress: victimEmail, password: tooShort },
        });
        expect((existing as any).errorCode).toBe('PASSWORD_VALIDATION_ERROR');

        const { registerCustomerAccount: fresh } = await shopClient.query(registerAccountDocument, {
            input: { emailAddress: `fresh-${suffix}@test.com`, password: tooShort },
        });
        expect((fresh as any).errorCode).toBe('PASSWORD_VALIDATION_ERROR');
    });

    it('hashes the supplied password on both branches, so registration time is not an oracle', async () => {
        // Registering against an account that already exists must cost the same as registering a
        // brand-new one. Password hashing dominates the cost of the request, so a branch that skips it
        // leaks whether the email address is already in use (GHSA-wr5h-x3x6-4h23). Counting the
        // hashing calls is the CI-safe way to assert this: wall-clock timing is too noisy.
        const cipher = server.app.get(PasswordCipher);
        const originalHash = cipher.hash.bind(cipher);
        let hashCalls = 0;
        cipher.hash = plaintext => {
            hashCalls++;
            return originalHash(plaintext);
        };
        try {
            const oracleEmail = `sso-oracle-victim-${suffix}@test.com`;
            await shopClient.asAnonymousUser();
            const { authenticate } = await shopClient.query(authenticateDocument, {
                input: { test_sso_strategy_shop: { email: oracleEmail } },
            });
            currentUserGuard.assertSuccess(authenticate);
            await shopClient.asAnonymousUser();

            hashCalls = 0;
            await shopClient.query(registerAccountDocument, {
                input: { emailAddress: oracleEmail, password: ATTACKER_PASSWORD },
            });
            const existingAccountHashCalls = hashCalls;

            hashCalls = 0;
            await shopClient.query(registerAccountDocument, {
                input: { emailAddress: `oracle-fresh-${suffix}@test.com`, password: ATTACKER_PASSWORD },
            });
            const newAccountHashCalls = hashCalls;

            expect(existingAccountHashCalls).toBe(1);
            expect(newAccountHashCalls).toBe(1);
        } finally {
            delete (cipher as any).hash;
        }
    });

    it('attacker cannot log in natively after registering a password against the SSO account', async () => {
        await shopClient.asAnonymousUser();

        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            // Attacker also supplies profile fields; these must not touch the victim's record (see the
            // profile-integrity test below).
            input: {
                emailAddress: victimEmail,
                password: ATTACKER_PASSWORD,
                firstName: 'ATTACKER',
                lastName: 'OVERWRITE',
                phoneNumber: '000-EVIL',
            },
        });
        // The mutation returns a generic success regardless, to avoid leaking that the email exists.
        successGuard.assertSuccess(registerCustomerAccount);
        expect(registerCustomerAccount.success).toBe(true);

        const { login } = await shopClient.query(attemptLoginDocument, {
            username: victimEmail,
            password: ATTACKER_PASSWORD,
        });
        currentUserGuard.assertErrorResult(login);
        expect(login.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
    });

    it("the attacker's registration does not overwrite the victim's Customer profile", async () => {
        // The previous test registered against the SSO account with attacker-supplied firstName /
        // lastName / phoneNumber. Because the caller is unauthenticated and unproven, those fields
        // must NOT be written to the victim's existing Customer (GHSA-wr5h). The victim's SSO-seeded
        // profile must survive untouched.
        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: { filter: { emailAddress: { eq: victimEmail } } },
        });
        const victim = customers.items.find(c => c.emailAddress === victimEmail)!;
        expect(victim.firstName).toBe('SSO Customer First Name');
        expect(victim.lastName).toBe('SSO Customer Last Name');
        // The SSO strategy never sets a phone number, so the seeded value is null and must stay null.
        expect(victim.phoneNumber).toBeNull();
    });

    it('publishes an AccountRegistrationEvent so the mailbox owner can claim the credential', async () => {
        // Holds regardless of requireVerification: the owner's only signal that a credential was
        // registered against their account is this event, which drives the verification email. It is
        // only delivered once the surrounding transaction has committed, which can happen after the
        // HTTP response, so poll rather than assert immediately.
        const findEvents = () => registrationEvents.filter(e => e.user.identifier === victimEmail);
        for (let i = 0; i < 50 && findEvents().length === 0; i++) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const events = findEvents();
        expect(events.length).toBe(1);
        const token = events[0].user.getNativeAuthenticationMethod().verificationToken;
        expect(typeof token).toBe('string');
        expect((token as string).length).toBeGreaterThan(0);
    });

    it('a second registration re-issues the token so the mailbox owner is not locked out', async () => {
        // The first registration (possibly the attacker's) leaves an unactivated credential on the
        // account. Returning early from then on would mean the owner never gets another verification
        // mail: they are already `verified`, so refreshCustomerVerification is a no-op too. A repeat
        // registration must therefore issue a fresh token and publish another AccountRegistrationEvent,
        // while still answering with the same generic success.
        const connection = server.app.get(TransactionalConnection);
        const readToken = async () => {
            const pendingMethod = await connection.rawConnection
                .getRepository(NativeAuthenticationMethod)
                .createQueryBuilder('method')
                .where('method.identifier = :identifier', { identifier: victimEmail })
                .getOne();
            return pendingMethod?.verificationToken;
        };
        const tokenBefore = await readToken();
        expect(typeof tokenBefore).toBe('string');
        const eventsBefore = registrationEvents.filter(e => e.user.identifier === victimEmail).length;

        await shopClient.asAnonymousUser();
        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input: { emailAddress: victimEmail, password: 'second-registration-password-123' },
        });
        successGuard.assertSuccess(registerCustomerAccount);
        expect(registerCustomerAccount.success).toBe(true);

        const tokenAfter = await readToken();
        expect(typeof tokenAfter).toBe('string');
        expect(tokenAfter).not.toBe(tokenBefore);

        // The event is only delivered once the surrounding transaction has committed, which can happen
        // after the HTTP response, so poll rather than assert immediately.
        const countEvents = () => registrationEvents.filter(e => e.user.identifier === victimEmail).length;
        for (let i = 0; i < 50 && countEvents() <= eventsBefore; i++) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(countEvents()).toBe(eventsBefore + 1);

        // The repeat registration still stores no password, so neither attempt can be logged in with.
        const method = await connection.rawConnection
            .getRepository(NativeAuthenticationMethod)
            .createQueryBuilder('method')
            .addSelect('method.passwordHash')
            .where('method.identifier = :identifier', { identifier: victimEmail })
            .getOne();
        expect(method?.passwordHash).toBe('');
        const { login } = await shopClient.query(attemptLoginDocument, {
            username: victimEmail,
            password: 'second-registration-password-123',
        });
        currentUserGuard.assertErrorResult(login);
        expect(login.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
    });

    // Only reachable with verification on: with it off a new registration is verified immediately, so
    // an existing-but-unverified native account cannot occur.
    it.runIf(requireVerification)(
        'a re-registration does not overwrite the profile of an existing unverified account',
        async () => {
            // Same integrity rule as for the SSO account, applied to a native account that has not been
            // verified yet. The caller is still unauthenticated and unproven, so an attacker must not be
            // able to blank or rewrite the owner's stored name and phone number.
            const pendingEmail = `pending-native-${suffix}@test.com`;
            await shopClient.asAnonymousUser();
            const { registerCustomerAccount: first } = await shopClient.query(registerAccountDocument, {
                input: {
                    emailAddress: pendingEmail,
                    password: OWNER_PASSWORD,
                    firstName: 'Real',
                    lastName: 'Owner',
                    phoneNumber: '555-0100',
                },
            });
            successGuard.assertSuccess(first);

            const { registerCustomerAccount: second } = await shopClient.query(registerAccountDocument, {
                input: {
                    emailAddress: pendingEmail,
                    password: ATTACKER_PASSWORD,
                    firstName: 'ATTACKER',
                    lastName: 'OVERWRITE',
                    phoneNumber: '000-EVIL',
                },
            });
            successGuard.assertSuccess(second);

            const { customers } = await adminClient.query(getCustomerListDocument, {
                options: { filter: { emailAddress: { eq: pendingEmail } } },
            });
            const pendingCustomer = customers.items.find(c => c.emailAddress === pendingEmail)!;
            expect(pendingCustomer.firstName).toBe('Real');
            expect(pendingCustomer.lastName).toBe('Owner');
            expect(pendingCustomer.phoneNumber).toBe('555-0100');
        },
    );

    it('victim account stays verified and the existing SSO login keeps working', async () => {
        const { customer } = await adminClient.query(getCustomerUserAuthDocument, {
            id: victimCustomerId,
        });
        expect(customer?.user?.verified).toBe(true);

        await shopClient.asAnonymousUser();
        const { authenticate } = await shopClient.query(authenticateDocument, {
            input: { test_sso_strategy_shop: { email: victimEmail } },
        });
        currentUserGuard.assertSuccess(authenticate);
        expect(authenticate.identifier).toBe(victimEmail);
        await shopClient.asAnonymousUser();
    });

    it('a password-less verify does not activate the attacker credential (one-click phishing blocked)', async () => {
        // The victim receives a verification email (triggered by the attacker's registration) and
        // clicks it, calling verifyCustomerAccount with NO password. Because the planted credential has
        // an empty passwordHash, this must NOT silently confirm anything: it returns MissingPasswordError
        // so the victim is forced to set their own password. This is the exact step where a
        // "store the password then gate the login" fix would instead activate the attacker's password.
        const connection = server.app.get(TransactionalConnection);
        const nativeMethod = await connection.rawConnection
            .getRepository(NativeAuthenticationMethod)
            .createQueryBuilder('method')
            .where('method.identifier = :identifier', { identifier: victimEmail })
            .getOne();
        const token = nativeMethod?.verificationToken;
        expect(typeof token).toBe('string');

        await shopClient.asAnonymousUser();
        const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
            token: token!,
            password: null,
        });

        // SECURITY INVARIANT (implementation-neutral): whatever the verify call returns, the victim's
        // click must NOT have made the attacker's password usable. A "store the password then gate the
        // login" fix fails exactly here, because the password-less verify silently activates the stored
        // attacker hash. Any correct fix must keep this assertion green.
        const { login } = await shopClient.query(attemptLoginDocument, {
            username: victimEmail,
            password: ATTACKER_PASSWORD,
        });
        currentUserGuard.assertErrorResult(login);
        expect(login.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);

        // Our fix additionally rejects the password-less verify (empty passwordHash) so the owner is
        // forced to set their own password; the token survives for them. Shop-only error code, not in
        // the admin `ErrorCode` enum imported here.
        currentUserGuard.assertErrorResult(verifyCustomerAccount);
        expect(verifyCustomerAccount.errorCode).toBe('MISSING_PASSWORD_ERROR');
    });

    it('only the mailbox owner can activate a native password, via the verification token', async () => {
        const connection = server.app.get(TransactionalConnection);
        const nativeMethod = await connection.rawConnection
            .getRepository(NativeAuthenticationMethod)
            .createQueryBuilder('method')
            .addSelect('method.passwordHash')
            .where('method.identifier = :identifier', { identifier: victimEmail })
            .getOne();
        // The attacker's password was never stored: the credential is gated behind email confirmation.
        expect(nativeMethod?.passwordHash).toBe('');
        const token = nativeMethod?.verificationToken;
        expect(typeof token).toBe('string');

        // An attacker who does not control the mailbox cannot guess the token to set a password.
        const { verifyCustomerAccount: bogus } = await shopClient.query(verifyEmailDocument, {
            token: 'not-the-real-token',
            password: ATTACKER_PASSWORD,
        });
        currentUserGuard.assertErrorResult(bogus);
        // Shop-only error code; the admin `ErrorCode` enum imported here does not include it.
        expect(bogus.errorCode).toBe('VERIFICATION_TOKEN_INVALID_ERROR');

        // The owner sets their own password when consuming the real token.
        const { verifyCustomerAccount } = await shopClient.query(verifyEmailDocument, {
            token: token!,
            password: OWNER_PASSWORD,
        });
        currentUserGuard.assertSuccess(verifyCustomerAccount);
        expect(verifyCustomerAccount.identifier).toBe(victimEmail);

        // The owner's password now works.
        await shopClient.asAnonymousUser();
        const { login: ownerLogin } = await shopClient.query(attemptLoginDocument, {
            username: victimEmail,
            password: OWNER_PASSWORD,
        });
        currentUserGuard.assertSuccess(ownerLogin);
        await shopClient.asAnonymousUser();

        // The attacker's original password never becomes valid.
        const { login: attackerLogin } = await shopClient.query(attemptLoginDocument, {
            username: victimEmail,
            password: ATTACKER_PASSWORD,
        });
        currentUserGuard.assertErrorResult(attackerLogin);
        expect(attackerLogin.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
    });

    it('re-registration against the activated account cannot reset the password', async () => {
        // Once the account has a native credential (activated in the previous test), a further
        // registration must be an enumeration-safe no-op and must not overwrite the owner's password.
        await shopClient.asAnonymousUser();
        const secondAttackerPassword = 'second-attacker-password-789';
        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input: { emailAddress: victimEmail, password: secondAttackerPassword },
        });
        successGuard.assertSuccess(registerCustomerAccount);
        expect(registerCustomerAccount.success).toBe(true);

        const { login: ownerLogin } = await shopClient.query(attemptLoginDocument, {
            username: victimEmail,
            password: OWNER_PASSWORD,
        });
        currentUserGuard.assertSuccess(ownerLogin);
        await shopClient.asAnonymousUser();

        const { login: attackerLogin } = await shopClient.query(attemptLoginDocument, {
            username: victimEmail,
            password: secondAttackerPassword,
        });
        currentUserGuard.assertErrorResult(attackerLogin);
        expect(attackerLogin.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
    });

    it('login gate refuses a native credential that still carries a verification token (backstop)', async () => {
        // Craft, directly in the DB, the state the backstop defends against: an external account left
        // UNVERIFIED whose native credential has a real password AND a pending verificationToken. This
        // is the shape an install exploited before this patch carries, since the old registration path
        // set `verified` to false when it planted the password. The verified-flag gate covers it only
        // while `requireVerification` is on, so the per-credential gate has to be what refuses it once
        // that option is switched off. Asserted in both modes for exactly that reason.
        const gateEmail = `gate-victim-${suffix}@test.com`;
        const gatePassword = 'gate-password-123';
        await shopClient.asAnonymousUser();
        const { authenticate } = await shopClient.query(authenticateDocument, {
            input: { test_sso_strategy_shop: { email: gateEmail } },
        });
        currentUserGuard.assertSuccess(authenticate);

        const connection = server.app.get(TransactionalConnection);
        const passwordCipher = server.app.get(PasswordCipher);
        const user = await connection.rawConnection
            .getRepository(User)
            .findOne({ where: { identifier: gateEmail }, relations: { authenticationMethods: true } });
        const method = new NativeAuthenticationMethod();
        method.identifier = gateEmail;
        method.passwordHash = await passwordCipher.hash(gatePassword);
        method.verificationToken = 'pending-token-xyz';
        method.user = user!;
        await connection.rawConnection.getRepository(NativeAuthenticationMethod).save(method);
        await connection.rawConnection.getRepository(User).update({ id: user!.id }, { verified: false });

        await shopClient.asAnonymousUser();
        const { login } = await shopClient.query(attemptLoginDocument, {
            username: gateEmail,
            password: gatePassword,
        });
        currentUserGuard.assertErrorResult(login);
        // Shop-only error code; the admin `ErrorCode` enum imported here does not include it.
        expect(login.errorCode).toBe('NOT_VERIFIED_ERROR');
    });

    it('a verified account with a leftover verification token can still log in', async () => {
        // Legitimate shape that exists on installs upgrading to this patch: before it, completing a
        // password reset marked the account verified without clearing the verificationToken. Those
        // customers chose their own password, so the backstop must not lock them out, and a later
        // registration against the address must not wipe that password either.
        //
        // Such a credential is usable, so it is not pending activation. A registration against the
        // address is a no-op: no token rotation, no AccountRegistrationEvent, no history entry.
        // Otherwise any anonymous caller who knows the address could make Vendure mail a verification
        // token to a customer who is already logging in (GHSA-wr5h-x3x6-4h23).
        const staleEmail = `stale-token-customer-${suffix}@test.com`;
        const stalePassword = 'stale-token-password-123';
        await shopClient.asAnonymousUser();
        const { authenticate } = await shopClient.query(authenticateDocument, {
            input: { test_sso_strategy_shop: { email: staleEmail } },
        });
        currentUserGuard.assertSuccess(authenticate);
        await shopClient.asAnonymousUser();

        const connection = server.app.get(TransactionalConnection);
        const passwordCipher = server.app.get(PasswordCipher);
        const user = await connection.rawConnection
            .getRepository(User)
            .findOne({ where: { identifier: staleEmail }, relations: { authenticationMethods: true } });
        const method = new NativeAuthenticationMethod();
        method.identifier = staleEmail;
        method.passwordHash = await passwordCipher.hash(stalePassword);
        method.verificationToken = 'stale-token-abc';
        method.user = user!;
        await connection.rawConnection.getRepository(NativeAuthenticationMethod).save(method);
        // The account stays verified, which is what the reset did.

        const { login } = await shopClient.query(attemptLoginDocument, {
            username: staleEmail,
            password: stalePassword,
        });
        currentUserGuard.assertSuccess(login);
        expect(login.identifier).toBe(staleEmail);
        await shopClient.asAnonymousUser();

        // A registration against the address leaves the credential exactly as it was.
        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: { filter: { emailAddress: { eq: staleEmail } } },
        });
        const staleCustomerId = customers.items.find(c => c.emailAddress === staleEmail)!.id;
        const countRegisteredEntries = async () => {
            const { customer: withHistory } = await adminClient.query(getCustomerHistoryDocument, {
                id: staleCustomerId,
                options: { filter: { type: { eq: HistoryEntryType.CUSTOMER_REGISTERED } } },
            });
            return withHistory!.history.totalItems;
        };
        const historyBefore = await countRegisteredEntries();
        const eventsBefore = registrationEvents.filter(e => e.user.identifier === staleEmail).length;

        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input: { emailAddress: staleEmail, password: ATTACKER_PASSWORD },
        });
        successGuard.assertSuccess(registerCustomerAccount);
        const afterRegister = await connection.rawConnection
            .getRepository(NativeAuthenticationMethod)
            .createQueryBuilder('method')
            .addSelect('method.passwordHash')
            .where('method.identifier = :identifier', { identifier: staleEmail })
            .getOne();
        expect(afterRegister?.passwordHash).not.toBe('');
        expect(afterRegister?.verificationToken).toBe('stale-token-abc');

        // No verification email and no history entry for the account owner. The event is published
        // after the surrounding transaction commits, so allow it time to arrive before asserting it
        // never does.
        await new Promise(resolve => setTimeout(resolve, 500));
        expect(registrationEvents.filter(e => e.user.identifier === staleEmail).length).toBe(eventsBefore);
        expect(await countRegisteredEntries()).toBe(historyBefore);

        const { login: afterLogin } = await shopClient.query(attemptLoginDocument, {
            username: staleEmail,
            password: stalePassword,
        });
        currentUserGuard.assertSuccess(afterLogin);
        await shopClient.asAnonymousUser();

        // The password supplied by that registration never becomes valid.
        const { login: attackerLogin } = await shopClient.query(attemptLoginDocument, {
            username: staleEmail,
            password: ATTACKER_PASSWORD,
        });
        currentUserGuard.assertErrorResult(attackerLogin);
        expect(attackerLogin.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
    });

    // Legacy shape the carve-out used to wave through: a native credential with a real password and
    // NO verificationToken on a User whose `verified` flag is false, alongside an external method. The
    // per-credential gate cannot see this one, so the verified-flag check has to catch it, and it must
    // not be skipped merely because the account has an external method.
    const carveOutEmail = `carve-out-victim-${suffix}@test.com`;
    const carveOutPassword = 'carve-out-password-123';

    async function seedUnverifiedNativeCredentialOnSsoAccount() {
        await shopClient.asAnonymousUser();
        const { authenticate } = await shopClient.query(authenticateDocument, {
            input: { test_sso_strategy_shop: { email: carveOutEmail } },
        });
        currentUserGuard.assertSuccess(authenticate);
        await shopClient.asAnonymousUser();

        const connection = server.app.get(TransactionalConnection);
        const passwordCipher = server.app.get(PasswordCipher);
        const user = await connection.rawConnection
            .getRepository(User)
            .findOne({ where: { identifier: carveOutEmail }, relations: { authenticationMethods: true } });
        const method = new NativeAuthenticationMethod();
        method.identifier = carveOutEmail;
        method.passwordHash = await passwordCipher.hash(carveOutPassword);
        method.verificationToken = null;
        method.user = user!;
        await connection.rawConnection.getRepository(NativeAuthenticationMethod).save(method);
        await connection.rawConnection.getRepository(User).update({ id: user!.id }, { verified: false });
    }

    async function expectSsoLoginStillWorks() {
        const { authenticate: ssoLogin } = await shopClient.query(authenticateDocument, {
            input: { test_sso_strategy_shop: { email: carveOutEmail } },
        });
        currentUserGuard.assertSuccess(ssoLogin);
        expect(ssoLogin.identifier).toBe(carveOutEmail);
        await shopClient.asAnonymousUser();
    }

    it.runIf(requireVerification)(
        'the external carve-out does not let an unverified native credential log in',
        async () => {
            await seedUnverifiedNativeCredentialOnSsoAccount();

            const { login } = await shopClient.query(attemptLoginDocument, {
                username: carveOutEmail,
                password: carveOutPassword,
            });
            currentUserGuard.assertErrorResult(login);
            // Shop-only error code; the admin `ErrorCode` enum imported here does not include it.
            expect(login.errorCode).toBe('NOT_VERIFIED_ERROR');
            await shopClient.asAnonymousUser();

            // The external login must keep working: that is what the carve-out is for.
            await expectSsoLoginStillWorks();
        },
    );

    it.runIf(!requireVerification)(
        'with verification switched off an unverified native credential is still a normal login',
        async () => {
            await seedUnverifiedNativeCredentialOnSsoAccount();

            const { login } = await shopClient.query(attemptLoginDocument, {
                username: carveOutEmail,
                password: carveOutPassword,
            });
            currentUserGuard.assertSuccess(login);
            expect(login.identifier).toBe(carveOutEmail);
            await shopClient.asAnonymousUser();

            await expectSsoLoginStillWorks();
        },
    );

    it('an unverified SSO-only victim gets a fresh token on every registration, never a password', async () => {
        // The victim's external provider did not vouch for the email address, so the account is not
        // verified. The first registration adds the unactivated credential; the second takes the
        // ordinary unverified path, which must also only refresh the token.
        const unverifiedEmail = `sso-unverified-victim-${suffix}@test.com`;
        await shopClient.asAnonymousUser();
        const { authenticate } = await shopClient.query(authenticateDocument, {
            input: { test_sso_strategy_shop: { email: unverifiedEmail } },
        });
        currentUserGuard.assertSuccess(authenticate);
        await shopClient.asAnonymousUser();

        const connection = server.app.get(TransactionalConnection);
        const seededUser = await connection.rawConnection
            .getRepository(User)
            .findOne({ where: { identifier: unverifiedEmail } });
        await connection.rawConnection
            .getRepository(User)
            .update({ id: seededUser!.id }, { verified: false });

        const readMethod = async () =>
            connection.rawConnection
                .getRepository(NativeAuthenticationMethod)
                .createQueryBuilder('method')
                .addSelect('method.passwordHash')
                .where('method.identifier = :identifier', { identifier: unverifiedEmail })
                .getOne();

        const { registerCustomerAccount: first } = await shopClient.query(registerAccountDocument, {
            input: { emailAddress: unverifiedEmail, password: ATTACKER_PASSWORD },
        });
        successGuard.assertSuccess(first);
        const afterFirst = await readMethod();
        expect(afterFirst?.passwordHash).toBe('');
        expect(typeof afterFirst?.verificationToken).toBe('string');

        const { registerCustomerAccount: second } = await shopClient.query(registerAccountDocument, {
            input: { emailAddress: unverifiedEmail, password: 'another-attacker-password-123' },
        });
        successGuard.assertSuccess(second);
        const afterSecond = await readMethod();
        expect(afterSecond?.passwordHash).toBe('');
        expect(typeof afterSecond?.verificationToken).toBe('string');
        expect(afterSecond?.verificationToken).not.toBe(afterFirst?.verificationToken);

        // The account stays unverified and neither supplied password works.
        const stillUnverified = await connection.rawConnection
            .getRepository(User)
            .findOne({ where: { identifier: unverifiedEmail } });
        expect(stillUnverified?.verified).toBe(false);
        for (const password of [ATTACKER_PASSWORD, 'another-attacker-password-123']) {
            const { login } = await shopClient.query(attemptLoginDocument, {
                username: unverifiedEmail,
                password,
            });
            currentUserGuard.assertErrorResult(login);
            expect(login.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
        }
    });

    it('the mailbox owner can claim the account via password reset (recovery path)', async () => {
        // A password reset is the recovery path that must work regardless of requireVerification: many
        // storefronts with requireVerification: false expose only a reset route, not a verify route.
        // Completing a reset proves mailbox ownership, so it must clear the pending verificationToken
        // and leave the native credential usable. Uses a fresh SSO victim to avoid the other tests.
        const resetEmail = `sso-reset-victim-${suffix}@test.com`;
        const resetOwnerPassword = 'reset-owner-password-789';
        await shopClient.asAnonymousUser();
        const { authenticate } = await shopClient.query(authenticateDocument, {
            input: { test_sso_strategy_shop: { email: resetEmail } },
        });
        currentUserGuard.assertSuccess(authenticate);
        await shopClient.asAnonymousUser();

        // Attacker plants an unactivated native credential.
        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input: { emailAddress: resetEmail, password: ATTACKER_PASSWORD },
        });
        successGuard.assertSuccess(registerCustomerAccount);

        // Owner requests and completes a password reset.
        await shopClient.query(requestPasswordResetDocument, { identifier: resetEmail });
        const connection = server.app.get(TransactionalConnection);
        const method = await connection.rawConnection
            .getRepository(NativeAuthenticationMethod)
            .createQueryBuilder('method')
            .addSelect('method.passwordResetToken')
            .where('method.identifier = :identifier', { identifier: resetEmail })
            .getOne();
        const resetToken = method?.passwordResetToken;
        expect(typeof resetToken).toBe('string');

        const { resetPassword } = await shopClient.query(resetPasswordDocument, {
            token: resetToken!,
            password: resetOwnerPassword,
        });
        currentUserGuard.assertSuccess(resetPassword);

        // The owner's reset password now logs in; the reset cleared the pending verificationToken so
        // the backstop gate no longer refuses the (now-owned) credential.
        await shopClient.asAnonymousUser();
        const { login: ownerLogin } = await shopClient.query(attemptLoginDocument, {
            username: resetEmail,
            password: resetOwnerPassword,
        });
        currentUserGuard.assertSuccess(ownerLogin);
        await shopClient.asAnonymousUser();

        // The attacker's password never becomes valid.
        const { login: attackerLogin } = await shopClient.query(attemptLoginDocument, {
            username: resetEmail,
            password: ATTACKER_PASSWORD,
        });
        currentUserGuard.assertErrorResult(attackerLogin);
        expect(attackerLogin.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
    });
}

describe('SSO account-takeover protection (GHSA-wr5h-x3x6-4h23), requireVerification: true', () => {
    runSsoTakeoverSuite(true);
});

describe('SSO account-takeover protection (GHSA-wr5h-x3x6-4h23), requireVerification: false', () => {
    runSsoTakeoverSuite(false);
});
