import ms, { type StringValue } from 'ms';

import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common';
import { generatePublicId } from '../../common/generate-public-id';
import { ConfigService } from '../config.service';

import { VerificationTokenStrategy } from './verification-token-strategy';

/**
 * @description
 * The default VerificationTokenStrategy which generates a token consisting of the
 * base64-encoded current time concatenated with a random id. The token is considered
 * valid if the current time is within the configured `verificationTokenDuration` of the
 * time encoded in the token.
 *
 * @docsCategory auth
 * @since 3.2.0
 */
export class DefaultVerificationTokenStrategy implements VerificationTokenStrategy {
    private configService: ConfigService;

    init(injector: Injector) {
        this.configService = injector.get(ConfigService);
    }

    /**
     * Generates a verification token which encodes the time of generation and concatenates it with a
     * random id.
     */
    generateVerificationToken(_ctx: RequestContext): string {
        const now = new Date();
        const base64Now = Buffer.from(now.toJSON()).toString('base64');
        const id = generatePublicId();
        return `${base64Now}_${id}`;
    }

    /**
     * Checks the age of the verification token to see if it falls within the token duration
     * as specified in the VendureConfig.
     */
    verifyVerificationToken(_ctx: RequestContext, token: string): boolean {
        const { verificationTokenDuration } = this.configService.authOptions;
        const verificationTokenDurationInMs =
            typeof verificationTokenDuration === 'string'
                ? ms(verificationTokenDuration as StringValue)
                : verificationTokenDuration;

        const [generatedOn] = token.split('_');
        const dateString = Buffer.from(generatedOn, 'base64').toString();
        const date = new Date(dateString);
        const elapsed = +new Date() - +date;
        return elapsed < verificationTokenDurationInMs;
    }
}
