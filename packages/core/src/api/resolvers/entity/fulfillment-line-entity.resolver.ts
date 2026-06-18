import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Fulfillment } from '../../../entity/fulfillment/fulfillment.entity';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { FulfillmentLine } from '../../../entity/order-line-reference/fulfillment-line.entity';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('FulfillmentLine')
export class FulfillmentLineEntityResolver {
    constructor(private connection: TransactionalConnection) {}

    @ResolveField()
    async orderLine(@Ctx() ctx: RequestContext, @Parent() fulfillmentLine: FulfillmentLine) {
        return this.connection
            .getRepository(ctx, OrderLine)
            .findOne({ where: { id: fulfillmentLine.orderLineId } });
    }

    @ResolveField()
    async fulfillment(@Ctx() ctx: RequestContext, @Parent() fulfillmentLine: FulfillmentLine) {
        return this.connection
            .getRepository(ctx, Fulfillment)
            .findOne({ where: { id: fulfillmentLine.fulfillmentId } });
    }
}
