import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../api';
import { ConfigService } from '../../../config/config.service';

/**
 * This class is responsible for generating and verifying the tokens issued when new accounts are registered
 * or when a password reset is requested.
 */
@Injectable()
export class VerificationTokenGenerator {
    constructor(private configService: ConfigService) {}

    /**
     * Generates a verification token using the configured {@link VerificationTokenStrategy}.
     * @param ctx The RequestContext object.
     * @returns The generated token.
     */
    async generateVerificationToken(ctx: RequestContext): Promise<string> {
        return this.configService.authOptions.verificationTokenStrategy.generateVerificationToken(ctx);
    }

    /**
     * Verifies a verification token using the configured {@link VerificationTokenStrategy}.
     * @param ctx The RequestContext object.
     * @param token The token to verify.
     * @returns `true` if the token is valid, `false` otherwise.
     */
    async verifyVerificationToken(ctx: RequestContext, token: string): Promise<boolean> {
        return this.configService.authOptions.verificationTokenStrategy.verifyVerificationToken(ctx, token);
    }
}
