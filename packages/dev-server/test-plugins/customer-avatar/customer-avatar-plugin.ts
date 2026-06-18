import { Asset, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api-extensions';
import { CustomerAvatarResolver } from './customer-avatar.resolver';

@VendurePlugin({
    imports: [PluginCommonModule],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [CustomerAvatarResolver],
    },
    configuration: config => {
        config.customFields.Customer.push({
            name: 'avatar',
            type: 'relation',
            entity: Asset,
            nullable: true,
        });
        return config;
    },
})
export class CustomerAvatarPlugin {}
