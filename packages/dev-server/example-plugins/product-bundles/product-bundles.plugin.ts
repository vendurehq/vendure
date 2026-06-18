import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { AdminUiExtension } from '@vendure/ui-devkit/compiler';
import path from 'path';

import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';
import { ProductBundleAdminResolver } from './api/product-bundle-admin.resolver';
import { ProductBundleShopResolver } from './api/product-bundle-shop.resolver';
import { BundleOrderInterceptor } from './config/bundle-order-interceptor';
import { productBundlePermission } from './constants';
import { ProductBundleItem } from './entities/product-bundle-item.entity';
import { ProductBundle } from './entities/product-bundle.entity';
import { ProductBundleItemService } from './services/product-bundle-item.service';
import { ProductBundleService } from './services/product-bundle.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ProductBundle, ProductBundleItem],
    configuration: config => {
        config.customFields.OrderLine.push({
            type: 'struct',
            name: 'fromBundle',
            fields: [
                { name: 'bundleId', type: 'string' },
                { name: 'bundleName', type: 'string' },
            ],
        });
        config.orderOptions.orderInterceptors.push(new BundleOrderInterceptor());
        config.authOptions.customPermissions.push(productBundlePermission);
        return config;
    },
    providers: [ProductBundleService, ProductBundleItemService],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [ProductBundleAdminResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [ProductBundleShopResolver],
    },
})
export class ProductBundlesPlugin {
    static uiExtensions: AdminUiExtension = {
        id: 'product-bundles',
        extensionPath: path.join(__dirname, 'ui'),
        routes: [{ route: 'product-bundles', filePath: 'routes.ts' }],
        providers: ['providers.ts'],
    };
}
