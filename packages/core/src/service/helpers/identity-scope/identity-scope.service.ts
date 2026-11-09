import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../api/common/request-context';
import { ConfigService } from '../../../config/config.service';
import { Channel } from '../../../entity/channel/channel.entity';
import { Customer } from '../../../entity/customer/customer.entity';

/**
 * @description
 * Resolves customer identity scopes using the configured {@link IdentityScopeStrategy}.
 *
 * @docsCategory services
 * @since 4.0.0
 */
@Injectable()
export class IdentityScopeService {
    constructor(private configService: ConfigService) {}

    /**
     * @description
     * The identity scope of the given Channel.
     */
    async getScopeForChannel(channel: Channel): Promise<string> {
        return this.configService.authOptions.identityScopeStrategy.getIdentityScope(channel);
    }

    /**
     * @description
     * The identity scope of the active Channel. Every lookup of a Customer or customer User by
     * email address is limited to this scope.
     */
    async getActiveScope(ctx: RequestContext): Promise<string> {
        return this.getScopeForChannel(ctx.channel);
    }

    /**
     * @description
     * Whether the Customer belongs to the identity scope of the given Channel, and so may be a
     * member of it and act on it in the Shop API.
     */
    async isCustomerInChannelScope(customer: Pick<Customer, 'identityScope'>, channel: Channel) {
        return customer.identityScope === (await this.getScopeForChannel(channel));
    }
}
