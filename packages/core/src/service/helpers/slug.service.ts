import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../api/common/request-context';
import { ConfigService, SlugGenerateParams } from '../../config';

/**
 * @description
 * A service that handles slug generation using the configured SlugStrategy.
 *
 * @docsCategory services
 * @since 3.5.0
 */
@Injectable()
export class SlugService {
    constructor(private configService: ConfigService) {}

    /**
     * @description
     * Generates a slug from the input string using the configured SlugStrategy.
     *
     * @param ctx The request context
     * @param params The parameters for slug generation
     * @returns A URL-friendly slug string
     */
    async generate(ctx: RequestContext, params: SlugGenerateParams): Promise<string> {
        const strategy = this.configService.entityOptions.slugStrategy;
        if (!strategy) {
            throw new Error('No SlugStrategy configured');
        }
        return strategy.generate(ctx, params);
    }
}
