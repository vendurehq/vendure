import { VendureConfig } from '@vendure/core';
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
    plugins: [...MetaPlugin.init({})],
};
