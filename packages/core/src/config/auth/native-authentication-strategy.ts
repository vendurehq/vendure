import { ID } from '@vendure/common/lib/shared-types';
import { randomBytes } from 'crypto';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';

import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { NativeAuthenticationMethod } from '../../entity/authentication-method/native-authentication-method.entity';
import { User } from '../../entity/user/user.entity';

import { AuthenticationStrategy } from './authentication-strategy';

export interface NativeAuthenticationData {
    username: string;
    password: string;
}

export const NATIVE_AUTH_STRATEGY_NAME = 'native';

/**
 * The plaintext behind the dummy hash. `verifyUserPassword` checks a submitted password
 * against that hash when an account has no stored hash, so every login attempt costs the
 * same one hash round. Skip that round and the response time tells an unauthenticated
 * caller which email addresses are registered, and which of them use an external login
 * provider (GHSA-c63h-3vvx-48ph).
 *
 * The value is random, not a fixed literal. The `!!storedHash` test in `verifyUserPassword`
 * already stops a match against the dummy hash from authenticating anyone. A plaintext
 * nobody can guess means that deleting that test by accident does not turn one public
 * constant into a valid password for every account with no stored hash.
 */
const DUMMY_PASSWORD_PLAINTEXT = randomBytes(32).toString('hex');

/**
 * @description
 * This strategy implements a username/password credential-based authentication, with the credentials
 * being stored in the Vendure database. This is the default method of authentication, and it is advised
 * to keep it configured unless there is a specific reason not to.
 *
 * @docsCategory auth
 */
export class NativeAuthenticationStrategy implements AuthenticationStrategy<NativeAuthenticationData> {
    readonly name = NATIVE_AUTH_STRATEGY_NAME;

    private connection: TransactionalConnection;
    private passwordCipher: import('../../service/helpers/password-cipher/password-cipher').PasswordCipher;
    private userService: import('../../service/services/user.service').UserService;
    private dummyPasswordHashPromise: Promise<string> | undefined;

    async init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        // These are lazily-loaded to avoid a circular dependency
        const { PasswordCipher } = await import('../../service/helpers/password-cipher/password-cipher.js');
        const { UserService } = await import('../../service/services/user.service.js');
        this.passwordCipher = injector.get(PasswordCipher);
        this.userService = injector.get(UserService);
    }

    /**
     * A dummy hash in the format of the configured passwordHashingStrategy, checked against
     * when there is no real hash, so every login path runs one real round of the algorithm.
     *
     * Derived from the configured strategy, not from a hardcoded bcrypt string. Under a
     * custom passwordHashingStrategy such as argon2, checking a plaintext against a bcrypt
     * hash throws instead of hashing.
     *
     * Derived on first use, not in `init()`. `ConfigModule.getInjectableStrategies` lists
     * the authentication strategies before `passwordHashingStrategy`, and
     * `initInjectableStrategies` awaits them in that order, so deriving the hash in `init()`
     * would run before a custom hashing strategy has loaded its key material. The result is
     * memoized, so only the first failed login of a strategy instance pays the extra round.
     * A rejected derivation is not cached, so a later request retries instead of failing for
     * the life of the process.
     */
    private getDummyPasswordHash(): Promise<string> {
        if (!this.dummyPasswordHashPromise) {
            this.dummyPasswordHashPromise = this.passwordCipher.hash(DUMMY_PASSWORD_PLAINTEXT).catch(err => {
                this.dummyPasswordHashPromise = undefined;
                throw err;
            });
        }
        return this.dummyPasswordHashPromise;
    }

    defineInputType(): DocumentNode {
        return gql`
            input NativeAuthInput {
                username: String!
                password: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: NativeAuthenticationData): Promise<User | false> {
        const user = await this.userService.getUserByEmailAddress(ctx, data.username);
        if (!user) {
            // Perform a dummy password check to prevent timing attacks that could
            // be used to determine whether a user account exists.
            await this.passwordCipher.check(data.password, await this.getDummyPasswordHash());
            return false;
        }
        const passwordMatch = await this.verifyUserPassword(ctx, user.id, data.password);
        if (!passwordMatch) {
            return false;
        }
        return user;
    }

    /**
     * Verify the provided password against the one we have for the given user.
     */
    async verifyUserPassword(ctx: RequestContext, userId: ID, password: string): Promise<boolean> {
        const user = await this.connection.getRepository(ctx, User).findOne({
            where: { id: userId },
            relations: { authenticationMethods: true },
        });
        const nativeAuthMethod = user?.getNativeAuthenticationMethod(false);
        const storedHash = nativeAuthMethod
            ? (
                  await this.connection.getRepository(ctx, NativeAuthenticationMethod).findOne({
                      where: { id: nativeAuthMethod.id },
                      select: { passwordHash: true },
                  })
              )?.passwordHash
            : undefined;
        // Always run exactly one hash comparison. Use the dummy hash when there is no real
        // one: the user is gone, the user has no native method, or the method is unactivated
        // and its hash is empty. `passwordCipher.check` rejects an empty or malformed hash
        // without running a hash round, so an early return, or a check against '', answers
        // faster and tells an unauthenticated caller whether the account exists and whether
        // it uses an external login provider (GHSA-c63h-3vvx-48ph).
        const hashToCheck = storedHash || (await this.getDummyPasswordHash());
        const passwordMatches = await this.passwordCipher.check(password, hashToCheck);
        // `!!storedHash` is what stops the dummy hash from authenticating anyone. A caller
        // who submits the dummy plaintext matches it, so the result must be false wherever
        // there is no real stored hash.
        return passwordMatches && !!storedHash;
    }
}
