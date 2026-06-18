import { Injectable } from '@nestjs/common';
import type {
  ListQueryOptions,
  PaginatedList,
  RelationPaths,
  RequestContext,
} from '@vendure/core';
import { ListQueryBuilder } from '@vendure/core';
import { SupplierStock } from '../../entities/supplier-stock.entity';

@Injectable()
export class SupplierStockService {
  constructor(private readonly listQueryBuilder: ListQueryBuilder) {}

  findAll(
    ctx: RequestContext,
    options?: ListQueryOptions<SupplierStock>,
    relations?: RelationPaths<SupplierStock>
  ): Promise<PaginatedList<SupplierStock>> {
    return this.listQueryBuilder
      .build(SupplierStock, options, {
        ctx,
        relations: relations ?? [
          'product',
          'productVariant',
          'supplier',
          'stocksInTransits',
        ],
      })
      .getManyAndCount()
      .then(([items, totalItems]) => {
        return {
          items,
          totalItems,
        };
      });
  }
}
