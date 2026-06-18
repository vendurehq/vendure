import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DeletionResponse,
    MutationCreateTaxRateArgs,
    MutationDeleteTaxRateArgs,
    MutationUpdateTaxRateArgs,
    MutationDeleteTaxRatesArgs,
    Permission,
    QueryTaxRateArgs,
    QueryTaxRatesArgs,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { TaxRate } from '../../../entity/tax-rate/tax-rate.entity';
import { TaxRateService } from '../../../service/services/tax-rate.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('TaxRate')
export class TaxRateResolver {
    constructor(private taxRateService: TaxRateService) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadCatalog, Permission.ReadProduct, Permission.ReadTaxRate)
    async taxRates(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryTaxRatesArgs,
        @Relations(TaxRate) relations: RelationPaths<TaxRate>,
    ): Promise<PaginatedList<TaxRate>> {
        return this.taxRateService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadCatalog, Permission.ReadTaxRate)
    async taxRate(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryTaxRateArgs,
        @Relations(TaxRate) relations: RelationPaths<TaxRate>,
    ): Promise<TaxRate | undefined> {
        return this.taxRateService.findOne(ctx, args.id, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateSettings, Permission.CreateTaxRate)
    async createTaxRate(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateTaxRateArgs,
    ): Promise<TaxRate> {
        return this.taxRateService.create(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateTaxRate)
    async updateTaxRate(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateTaxRateArgs,
    ): Promise<TaxRate> {
        return this.taxRateService.update(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteTaxRate)
    async deleteTaxRate(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteTaxRateArgs,
    ): Promise<DeletionResponse> {
        return this.taxRateService.delete(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteTaxRate)
    async deleteTaxRates(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteTaxRatesArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.taxRateService.delete(ctx, id)));
    }
}
