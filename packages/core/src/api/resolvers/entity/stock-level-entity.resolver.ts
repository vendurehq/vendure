import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { StockLevel } from '../../../entity/stock-level/stock-level.entity';
import { StockLevelService } from '../../../service/services/stock-level.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('StockLevel')
export class StockLevelAdminEntityResolver {
    constructor(private stockLevelService: StockLevelService) {}

    /**
     * Whether inventory is tracked at this StockLevel in the active Channel, after resolving
     * INHERIT against the ProductVariant and the Channel.
     */
    @ResolveField()
    async tracksInventory(@Ctx() ctx: RequestContext, @Parent() stockLevel: StockLevel): Promise<boolean> {
        return this.stockLevelService.isStockLevelTracked(ctx, stockLevel);
    }
}
