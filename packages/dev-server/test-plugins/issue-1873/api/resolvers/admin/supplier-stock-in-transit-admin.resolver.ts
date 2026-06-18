import { Args, Query, Resolver } from '@nestjs/graphql';
import { Ctx, RequestContext } from '@vendure/core';
import { QuerySupplierStockInTransitsArgs } from '../../../generated-admin-types';
import { SupplierStockInTransitService } from '../../services/supplier-stock-in-transit.service';

@Resolver()
export class SupplierStockInTransitAdminResolver {
  constructor(
    private readonly supplierStockInTransitService: SupplierStockInTransitService
  ) {}

  @Query()
  supplierStockInTransits(
    @Ctx() ctx: RequestContext,
    @Args() args: QuerySupplierStockInTransitsArgs
  ) {
    return this.supplierStockInTransitService.findAll(ctx, args.options);
  }
}
