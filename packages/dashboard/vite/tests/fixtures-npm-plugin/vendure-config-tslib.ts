import { VendureConfig } from '@vendure/core';
import { TestTslibPlugin } from 'test-plugin-tslib';

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
    plugins: [TestTslibPlugin],
};
