import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DuplicateEntityResult,
    MutationDuplicateEntityArgs,
    Permission,
} from '@vendure/common/lib/generated-types';

import { EntityDuplicatorService } from '../../../service/helpers/entity-duplicator/entity-duplicator.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver()
export class DuplicateEntityResolver {
    constructor(private entityDuplicatorService: EntityDuplicatorService) {}

    @Query()
    @Allow(Permission.Authenticated)
    async entityDuplicators(@Ctx() ctx: RequestContext) {
        return this.entityDuplicatorService.getEntityDuplicators(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async duplicateEntity(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDuplicateEntityArgs,
    ): Promise<DuplicateEntityResult> {
        return this.entityDuplicatorService.duplicateEntity(ctx, args.input);
    }
}
