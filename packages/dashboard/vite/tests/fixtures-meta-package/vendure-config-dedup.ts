import { VendureConfig } from '@vendure/core';
import { ChildPluginA } from 'child-plugin-a';
import { MetaPlugin } from 'meta-plugin';

export const config: VendureConfig = {
    apiOptions: {
        port: 3000,
    },
    authOptions: {
        tokenMethod: 'bearer',
    },
    dbConnectionOptions: {
        type: 'postgres',
    },
    paymentOptions: {
        paymentMethodHandlers: [],
    },
    plugins: [ChildPluginA, ...MetaPlugin.init({})],
};
