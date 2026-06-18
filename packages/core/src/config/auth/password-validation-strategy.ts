import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * Defines validation to apply to new password (when creating an account or updating an existing account's
 * password when using the {@link NativeAuthenticationStrategy}.
 *
 * :::info
 *
 * This is configured via the `authOptions.passwordValidationStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory auth
 * @since 1.5.0
 */
export interface PasswordValidationStrategy extends InjectableStrategy {
    /**
     * @description
     * Validates a password submitted during account registration or when a customer updates their password.
     * The method should resolve to `true` if the password is acceptable. If not, it should return `false` or
     * optionally a string which will be passed to the returned ErrorResult, which can e.g. advise on why
     * exactly the proposed password is not valid.
     *
     * @since 1.5.0
     */
    validate(ctx: RequestContext, password: string): Promise<boolean | string> | boolean | string;
}
