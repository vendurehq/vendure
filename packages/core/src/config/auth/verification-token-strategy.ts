import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * Defines a custom strategy for creating and validating verification tokens.
 *
 * :::info
 *
 * This is configured via the `authOptions.verificationTokenStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory auth
 * @since 3.2.0
 */
export interface VerificationTokenStrategy extends InjectableStrategy {
    /**
     * @description
     * Generates a verification token.
     *
     * @since 3.2.0
     */
    generateVerificationToken(ctx: RequestContext): Promise<string> | string;

    /**
     * @description
     * Checks the validity of a verification token.
     *
     * @since 3.2.0
     */
    verifyVerificationToken(ctx: RequestContext, token: string): Promise<boolean> | boolean;
}
