import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { Channel } from '../../../entity/channel/channel.entity';
import { Seller } from '../../../entity/seller/seller.entity';
import { TranslatorService } from '../../../service/helpers/translator/translator.service';
import { SellerService } from '../../../service/services/seller.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Channel')
export class ChannelEntityResolver {
    constructor(
        private sellerService: SellerService,
        private translator: TranslatorService,
    ) {}

    @ResolveField()
    async seller(@Ctx() ctx: RequestContext, @Parent() channel: Channel): Promise<Seller | undefined> {
        if (channel.seller) return this.translator.translate(channel.seller, ctx);

        return channel.sellerId ? this.sellerService.findOne(ctx, channel.sellerId) : undefined;
    }

    @ResolveField()
    currencyCode(@Ctx() ctx: RequestContext, @Parent() channel: Channel): string {
        return channel.defaultCurrencyCode;
    }
}
