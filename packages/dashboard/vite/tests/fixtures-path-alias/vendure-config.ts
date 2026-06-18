import { JsAliasedPlugin } from '@other/js-aliased';
import { TsAliasedPlugin } from '@other/ts-aliased';
import { StarAliasedPlugin } from '@plugins/star-aliased';
import { VendureConfig } from '@vendure/core';

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
    plugins: [StarAliasedPlugin, TsAliasedPlugin, JsAliasedPlugin],
};
