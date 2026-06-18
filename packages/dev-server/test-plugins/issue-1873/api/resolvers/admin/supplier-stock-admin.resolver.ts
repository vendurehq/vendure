import fs from 'fs';
import path from 'path';
import { Args, Query, Mutation, Resolver } from '@nestjs/graphql';
import type { PaginatedList } from '@vendure/core';
import {
  Logger,
  Ctx,
  RelationPaths,
  Relations,
  RequestContext,
  TransactionalConnection,
  Importer,
  Populator,
  ChannelService,
  ProductService,
} from '@vendure/core';
import { LOGGER_CTX } from '../../../constants';
import { SupplierStockInTransit } from '../../../entities/supplier-stock-in-transit.entity';
import { SupplierStock } from '../../../entities/supplier-stock.entity';
import { QuerySupplierStocksArgs } from '../../../generated-admin-types';
import { initialData } from '../../schema/admin-api/initial-data';
import { SupplierStockService } from '../../services/supplier-stock.service';

@Resolver()
export class SupplierStockAdminResolver {
  constructor(
    private readonly supplierStockService: SupplierStockService,
    private readonly connection: TransactionalConnection,
    private readonly populator: Populator,
    private readonly channelService: ChannelService,
    private readonly productService: ProductService,
    private readonly importer: Importer
  ) {}

  @Query()
  async supplierStocks(
    @Ctx() ctx: RequestContext,
    @Args() args: QuerySupplierStocksArgs,
    @Relations({
      entity: SupplierStock,
      omit: ['productVariant'],
    })
    relations: RelationPaths<SupplierStock>
  ): Promise<PaginatedList<SupplierStock>> {
    return this.supplierStockService.findAll(ctx, args.options, relations);
  }

  private async initVendureData(@Ctx() ctx: RequestContext) {
    const channel = await this.channelService.getDefaultChannel();
    await this.populator.populateInitialData(initialData, channel);

    const assetsDir = path.join(__dirname, '../../../../mock-data');
    const productsCsvPath = path.join(assetsDir, '/data-sources/products.csv');
    const productData = await fs.readFileSync(productsCsvPath, 'utf-8');

    const importResult = await this.importer
      .parseAndImport(productData, ctx, true)
      .toPromise();

    if (importResult.errors && importResult.errors.length) {
      const errorFile = path.join(process.cwd(), 'vendure-import-error.log');
      Logger.error(
        `${importResult.errors.length} errors encountered when importing product data. See: ${errorFile}`,
        LOGGER_CTX
      );
    }
    Logger.info(`Imported ${importResult.imported} products`, LOGGER_CTX);

    await this.populator.populateCollections(initialData, channel);
  }

  @Mutation()
  async initializeDemo(@Ctx() ctx: RequestContext) {
    const { totalItems } = await this.productService.findAll(ctx, {});
    if (totalItems === 0) {
      await this.initVendureData(ctx);
    }

    const supplierStock = await this.connection
      .getRepository(ctx, SupplierStock)
      .save({
        comment: 'stock comment',
        enabled: true,
        link: 'stock link',
        inTransitsStock: 10,
        stockArea: 'stock area',
        productId: 1,
        productVariantId: 1,
      });

    await this.connection.getRepository(ctx, SupplierStockInTransit).save({
      channelName: 'channel name',
      channelOrderNo: 'channel order number',
      quantity: 5,
      supplierStockId: supplierStock.id,
    });

    return true;
  }
}
