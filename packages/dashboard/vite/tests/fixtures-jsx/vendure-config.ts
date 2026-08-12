import { VendureConfig } from '@vendure/core';

import { MyPlugin } from './my-plugin/src/my.plugin.js';

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
    plugins: [MyPlugin],
};
