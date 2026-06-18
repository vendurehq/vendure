import { ID } from '@vendure/common/lib/shared-types';
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
 * A pre-computed bcrypt hash used for dummy password checks to prevent timing attacks.
 * When a user is not found, we still perform a hash comparison against this dummy value
 * to ensure consistent response times regardless of whether the user exists.
 * This mitigates user enumeration via timing analysis.
 */
const DUMMY_PASSWORD_HASH = '$2b$12$SFfIOqrqph9N4yvWLtbqteiV5C6GEN/YOumGLryDDbHeMLtSQo4/6';

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

    async init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        // These are lazily-loaded to avoid a circular dependency
        const { PasswordCipher } = await import('../../service/helpers/password-cipher/password-cipher.js');
        const { UserService } = await import('../../service/services/user.service.js');
        this.passwordCipher = injector.get(PasswordCipher);
        this.userService = injector.get(UserService);
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
            await this.passwordCipher.check(data.password, DUMMY_PASSWORD_HASH);
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
            relations: ['authenticationMethods'],
        });
        if (!user) {
            return false;
        }
        const nativeAuthMethod = user.getNativeAuthenticationMethod(false);
        if (!nativeAuthMethod) {
            return false;
        }
        const pw =
            (
                await this.connection.getRepository(ctx, NativeAuthenticationMethod).findOne({
                    where: { id: nativeAuthMethod.id },
                    select: ['passwordHash'],
                })
            )?.passwordHash ?? '';
        const passwordMatches = await this.passwordCipher.check(password, pw);
        if (!passwordMatches) {
            return false;
        }
        return true;
    }
}
