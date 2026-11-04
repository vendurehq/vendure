import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DeletionResponse,
    MutationCreateProvinceArgs,
    MutationDeleteProvinceArgs,
    MutationUpdateProvinceArgs,
    Permission,
    QueryProvinceArgs,
    QueryProvincesArgs,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { Translated } from '../../../common/types/locale-types';
import { Province } from '../../../entity/region/province.entity';
import { ProvinceService } from '../../../service/services/province.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('Province')
export class ProvinceResolver {
    constructor(private provinceService: ProvinceService) {}

    @Query()
    @Allow(Permission.ReadSettings)
    provinces(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProvincesArgs,
        @Relations(Province) relations: RelationPaths<Province>,
    ): Promise<PaginatedList<Translated<Province>>> {
        return this.provinceService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    province(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProvinceArgs,
        @Relations(Province) relations: RelationPaths<Province>,
    ): Promise<Translated<Province> | undefined> {
        return this.provinceService.findOne(ctx, args.id, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateSettings)
    async createProvince(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateProvinceArgs,
    ): Promise<Translated<Province>> {
        return this.provinceService.create(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings)
    async updateProvince(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateProvinceArgs,
    ): Promise<Translated<Province>> {
        return this.provinceService.update(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings)
    async deleteProvince(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteProvinceArgs,
    ): Promise<DeletionResponse> {
        return this.provinceService.delete(ctx, args.id);
    }
}
