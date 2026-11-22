import { Args, Query, Resolver } from '@nestjs/graphql';
import { Permission, QueryStoreReadinessArgs } from '@vendure/common/lib/generated-types';

import { StoreReadinessReport } from '../../../service/helpers/store-readiness/store-readiness-types';
import { StoreReadinessService } from '../../../service/services/store-readiness.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver()
export class StoreReadinessResolver {
    constructor(private storeReadinessService: StoreReadinessService) {}

    @Query()
    @Allow(Permission.ReadSettings)
    storeReadiness(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryStoreReadinessArgs,
    ): Promise<StoreReadinessReport> {
        return this.storeReadinessService.check(ctx, { channelIds: args.channelIds ?? undefined });
    }
}
