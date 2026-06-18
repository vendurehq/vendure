import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { SupplierStockAdminResolver } from './api/resolvers/admin/supplier-stock-admin.resolver';
import { SupplierStockInTransitAdminResolver } from './api/resolvers/admin/supplier-stock-in-transit-admin.resolver';
import { SupplierStockEntityResolver } from './api/resolvers/entity/suppiler-stock-entity.resolver';
import { adminApiExtensions } from './api/schema/admin-api';
import { SupplierStockInTransitService } from './api/services/supplier-stock-in-transit.service';
import { SupplierStockService } from './api/services/supplier-stock.service';
import { PLUGIN_INIT_OPTIONS } from './constants';
import { productVariantCustomFields } from './custom-fields/product-variant-custom-fields';
import { SupplierStockInTransit } from './entities/supplier-stock-in-transit.entity';
import { SupplierStock } from './entities/supplier-stock.entity';
import type { PluginInitOptions } from './types';

const services = [SupplierStockInTransitService, SupplierStockService];

@VendurePlugin({
  imports: [PluginCommonModule],
  entities: [SupplierStock, SupplierStockInTransit],
  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [
      SupplierStockAdminResolver,
      SupplierStockEntityResolver,
      SupplierStockInTransitAdminResolver,
    ],
  },
  providers: [
    ...services,

    // By definiting the `PLUGIN_INIT_OPTIONS` symbol as a provider, we can then inject the
    // user-defined options into other classes, such as the {@link ExampleService}.
    {
      provide: PLUGIN_INIT_OPTIONS,
      useFactory: () => IssueSupplierPlugin.options,
    },
  ],
  configuration: (config) => {
    config.customFields.ProductVariant.push(...productVariantCustomFields);
    return config;
  },
})
export class IssueSupplierPlugin {
  static options: PluginInitOptions = {};

  /**
   * The static `init()` method is a convention used by Vendure plugins which allows options
   * to be configured by the user.
   */
  static init(options: Partial<PluginInitOptions>) {
    this.options = { ...IssueSupplierPlugin.options, ...options };
    return IssueSupplierPlugin;
  }
}
