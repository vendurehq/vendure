import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { TransactionalConnection } from '../../connection/transactional-connection';

import { NativeAuthenticationStrategy } from './native-authentication-strategy';

// A bcrypt-shaped placeholder used to stand in for a real stored password. Deliberately
// distinct from the dummy hash so the two can never be conflated by accident.
const REAL_HASH = '$2b$12$RealStoredHashRealStoredHashRealStoredHashRealSto1234';
// A distinct dummy hash, as `getDummyPasswordHash()` derives from the configured strategy.
const DUMMY_HASH = '$2b$12$SFfIOqrqph9N4yvWLtbqteiV5C6GEN/YOumGLryDDbHeMLtSQo4/6';

/**
 * GHSA-c63h-3vvx-48ph: a login attempt must perform exactly one password hash
 * comparison on every branch, so it does not skip the ~one bcrypt round that used
 * to reveal, by response time, whether an email is an external-auth (SSO) account.
 * bcrypt rejects an empty hash without doing a real round, so "check was called" is
 * not enough: the hash it receives must be the exact expected hash (real or dummy),
 * never the empty string. A sub-millisecond DB-query-count difference between account
 * classes remains and is accepted; only the hashing oracle is closed here.
 */
describe('NativeAuthenticationStrategy timing safety (GHSA-c63h-3vvx-48ph)', () => {
    let strategy: NativeAuthenticationStrategy;
    let checkSpy: ReturnType<typeof vi.fn>;
    let hashSpy: ReturnType<typeof vi.fn>;
    let getUserByEmailAddress: ReturnType<typeof vi.fn>;
    let userRepoFindOne: ReturnType<typeof vi.fn>;
    let nativeMethodRepoFindOne: ReturnType<typeof vi.fn>;

    const ctx = {} as RequestContext;

    function makeUser(nativeMethod: any): any {
        return { id: 1, getNativeAuthenticationMethod: () => nativeMethod };
    }

    function setup(opts: { userByEmail: any; userById: any; passwordHash?: string | null }) {
        // Returns true only for the correct password against the real hash; every
        // other call resolves false. The point under test is how often, and with
        // what hash, this is invoked.
        checkSpy = vi.fn(async (pw: string, hash: string) => hash === REAL_HASH && pw === 'correct');
        getUserByEmailAddress = vi.fn(async () => opts.userByEmail);
        userRepoFindOne = vi.fn(async () => opts.userById);
        nativeMethodRepoFindOne = vi.fn(async () =>
            opts.passwordHash != null ? { passwordHash: opts.passwordHash } : undefined,
        );
        const connection = {
            getRepository: vi.fn((_ctx: any, entity: any) =>
                entity?.name === 'NativeAuthenticationMethod'
                    ? { findOne: nativeMethodRepoFindOne }
                    : { findOne: userRepoFindOne },
            ),
        } as unknown as TransactionalConnection;

        hashSpy = vi.fn(async () => DUMMY_HASH);
        strategy = new NativeAuthenticationStrategy();
        (strategy as any).connection = connection;
        // hash() feeds the lazily-derived dummy hash, exercising the real code path.
        (strategy as any).passwordCipher = { check: checkSpy, hash: hashSpy };
        (strategy as any).userService = { getUserByEmailAddress };
    }

    // Asserts exactly one hash comparison happened, against the exact expected hash
    // (never the empty string, which bcrypt would reject without a real round).
    function expectOneCheckAgainst(expectedHash: string) {
        expect(checkSpy).toHaveBeenCalledTimes(1);
        expect(checkSpy.mock.calls[0][1]).toBe(expectedHash);
    }

    it('email does not exist: one check against the dummy hash', async () => {
        setup({ userByEmail: undefined, userById: undefined });
        const result = await strategy.authenticate(ctx, { username: 'nobody@test.com', password: 'x' });
        expect(result).toBe(false);
        expectOneCheckAgainst(DUMMY_HASH);
    });

    it('email exists with a password, wrong password: one check against the real hash', async () => {
        const user = makeUser({ id: 10 });
        setup({ userByEmail: user, userById: user, passwordHash: REAL_HASH });
        const result = await strategy.authenticate(ctx, { username: 'has-pw@test.com', password: 'wrong' });
        expect(result).toBe(false);
        expectOneCheckAgainst(REAL_HASH);
    });

    it('email exists with a password, correct password: authenticates with one check against the real hash', async () => {
        const user = makeUser({ id: 10 });
        setup({ userByEmail: user, userById: user, passwordHash: REAL_HASH });
        const result = await strategy.authenticate(ctx, { username: 'has-pw@test.com', password: 'correct' });
        expect(result).toBe(user);
        expectOneCheckAgainst(REAL_HASH);
    });

    // The oracle the incomplete fix left open: an external-auth (SSO) account has
    // no NativeAuthenticationMethod, so verifyUserPassword returned before any hash.
    it('email exists but has no native auth method (SSO account): one check against the dummy hash', async () => {
        const user = makeUser(undefined);
        setup({ userByEmail: user, userById: user });
        const result = await strategy.authenticate(ctx, { username: 'sso@test.com', password: 'x' });
        expect(result).toBe(false);
        expectOneCheckAgainst(DUMMY_HASH);
    });

    // An unactivated native credential (empty passwordHash) must not reject faster
    // than a real hash would: bcrypt short-circuits on an empty hash.
    it('email exists with an unactivated native method (empty hash): one check against the dummy hash', async () => {
        const user = makeUser({ id: 10 });
        setup({ userByEmail: user, userById: user, passwordHash: '' });
        const result = await strategy.authenticate(ctx, { username: 'unactivated@test.com', password: 'x' });
        expect(result).toBe(false);
        expectOneCheckAgainst(DUMMY_HASH);
    });

    // The row can disappear between the email lookup and the id lookup.
    it('user vanishes between lookups: one check against the dummy hash', async () => {
        const user = makeUser({ id: 10 });
        setup({ userByEmail: user, userById: undefined });
        const result = await strategy.authenticate(ctx, { username: 'racy@test.com', password: 'x' });
        expect(result).toBe(false);
        expectOneCheckAgainst(DUMMY_HASH);
    });

    // The security-critical guard. If the cipher ever reports a match against the dummy
    // hash, login must still fail wherever there is no real stored hash. Without the
    // `&& !!storedHash` guard the dummy plaintext would be a valid password for every
    // SSO / unactivated account.
    it.each([
        ['no native auth method', undefined],
        ['an unactivated native method', ''],
    ])(
        'never authenticates against the dummy hash even when the cipher matches it: %s',
        async (_label, passwordHash) => {
            const user = makeUser(passwordHash === undefined ? undefined : { id: 10 });
            setup({ userByEmail: user, userById: user, passwordHash });
            checkSpy.mockImplementation(async () => true); // worst case: the dummy matches
            const result = await strategy.authenticate(ctx, {
                username: 'sso@test.com',
                password: 'any-password',
            });
            expect(result).toBe(false);
        },
    );

    // Defence in depth behind that guard: the dummy plaintext must not be a readable
    // constant an attacker could submit as a password. randomBytes(32).toString('hex')
    // gives 64 hex characters, so this fails if it is ever replaced by a literal.
    it('hashes an unguessable random plaintext to build the dummy hash', async () => {
        setup({ userByEmail: undefined, userById: undefined });
        await strategy.authenticate(ctx, { username: 'nobody@test.com', password: 'x' });
        expect(hashSpy).toHaveBeenCalledTimes(1);
        expect(hashSpy.mock.calls[0][0]).toMatch(/^[0-9a-f]{64}$/);
    });

    // The dummy hash is memoized, so only the first failed login of a strategy instance
    // pays the extra round. Deriving it again on every attempt would double the cost of
    // every failed login.
    it('derives the dummy hash once across repeated failed logins', async () => {
        setup({ userByEmail: undefined, userById: undefined });
        await strategy.authenticate(ctx, { username: 'nobody@test.com', password: 'x' });
        await strategy.authenticate(ctx, { username: 'nobody-else@test.com', password: 'x' });
        expect(hashSpy).toHaveBeenCalledTimes(1);
        expect(checkSpy).toHaveBeenCalledTimes(2);
        expect(checkSpy.mock.calls[1][1]).toBe(DUMMY_HASH);
    });

    // A rejected derivation must not be memoized, otherwise one transient failure in the
    // hashing strategy would break every subsequent login for the life of the process.
    it('retries the derivation after it rejects, instead of caching the failure', async () => {
        setup({ userByEmail: undefined, userById: undefined });
        hashSpy.mockRejectedValueOnce(new Error('hashing strategy not ready'));

        await expect(
            strategy.authenticate(ctx, { username: 'nobody@test.com', password: 'x' }),
        ).rejects.toThrow('hashing strategy not ready');
        expect(checkSpy).not.toHaveBeenCalled();

        const result = await strategy.authenticate(ctx, { username: 'nobody@test.com', password: 'x' });
        expect(result).toBe(false);
        expect(hashSpy).toHaveBeenCalledTimes(2);
        expectOneCheckAgainst(DUMMY_HASH);
    });
});
