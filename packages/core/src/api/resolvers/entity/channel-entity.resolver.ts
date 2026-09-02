import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { Translated } from '../../../common/types/locale-types';
import { Channel } from '../../../entity/channel/channel.entity';
import { Seller } from '../../../entity/seller/seller.entity';
import { SellerService } from '../../../service/services/seller.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Channel')
export class ChannelEntityResolver {
    constructor(private sellerService: SellerService) {}

    @ResolveField()
    async seller(
        @Ctx() ctx: RequestContext,
        @Parent() channel: Channel,
    ): Promise<Translated<Seller> | undefined> {
        const sellerId = channel.sellerId ?? channel.seller?.id;
        return sellerId ? this.sellerService.findOne(ctx, sellerId) : undefined;
    }

    @ResolveField()
    currencyCode(@Ctx() ctx: RequestContext, @Parent() channel: Channel): string {
        return channel.defaultCurrencyCode;
    }
}
