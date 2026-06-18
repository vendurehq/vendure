import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { Fulfillment } from '../../../entity/fulfillment/fulfillment.entity';
import { FulfillmentService } from '../../../service/services/fulfillment.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Fulfillment')
export class FulfillmentEntityResolver {
    constructor(
        private fulfillmentService: FulfillmentService,
        private requestContextCache: RequestContextCacheService,
    ) {}

    @ResolveField()
    async lines(@Ctx() ctx: RequestContext, @Parent() fulfillment: Fulfillment) {
        return this.requestContextCache.get(ctx, `FulfillmentEntityResolver.lines(${fulfillment.id})`, () =>
            this.fulfillmentService.getFulfillmentLines(ctx, fulfillment.id),
        );
    }

    @ResolveField()
    async summary(@Ctx() ctx: RequestContext, @Parent() fulfillment: Fulfillment) {
        return this.requestContextCache.get(ctx, `FulfillmentEntityResolver.lines(${fulfillment.id})`, () =>
            this.fulfillmentService.getFulfillmentLines(ctx, fulfillment.id),
        );
    }
}

@Resolver('Fulfillment')
export class FulfillmentAdminEntityResolver {
    constructor(private fulfillmentService: FulfillmentService) {}

    @ResolveField()
    async nextStates(@Parent() fulfillment: Fulfillment) {
        return this.fulfillmentService.getNextStates(fulfillment);
    }
}
