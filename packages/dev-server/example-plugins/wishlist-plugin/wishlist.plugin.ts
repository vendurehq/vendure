import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api/api-extensions';
import { WishlistShopResolver } from './api/wishlist.resolver';
import { WishlistItem } from './entities/wishlist-item.entity';
import { WishlistService } from './service/wishlist.service';
import './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [WishlistItem],
    providers: [WishlistService],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [WishlistShopResolver],
    },
    configuration: config => {
        config.customFields.Customer.push({
            name: 'wishlistItems',
            type: 'relation',
            list: true,
            entity: WishlistItem,
            internal: true,
        });
        return config;
    },
})
export class WishlistPlugin {}
