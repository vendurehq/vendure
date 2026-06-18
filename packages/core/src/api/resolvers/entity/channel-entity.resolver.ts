import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { Channel } from '../../../entity/channel/channel.entity';
import { Seller } from '../../../entity/seller/seller.entity';
import { SellerService } from '../../../service/services/seller.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Channel')
export class ChannelEntityResolver {
    constructor(private sellerService: SellerService) {}

    @ResolveField()
    async seller(@Ctx() ctx: RequestContext, @Parent() channel: Channel): Promise<Seller | undefined> {
        return channel.sellerId
            ? channel.seller ?? (await this.sellerService.findOne(ctx, channel.sellerId))
            : undefined;
    }

    @ResolveField()
    currencyCode(@Ctx() ctx: RequestContext, @Parent() channel: Channel): string {
        return channel.defaultCurrencyCode;
    }
}
