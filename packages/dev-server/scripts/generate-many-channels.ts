/* eslint-disable no-console */
import {
    bootstrapWorker,
    ChannelService,
    CurrencyCode,
    isGraphQlErrorResult,
    LanguageCode,
    RequestContextService,
    RoleService,
} from '@vendure/core';

import { devConfig } from '../dev-config';

const CHANNEL_COUNT = 1001;

generateManyChannels()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));

// Used for testing scenarios where there are many channels
// such as https://github.com/vendurehq/vendure/issues/2233
async function generateManyChannels() {
    const { app } = await bootstrapWorker(devConfig);
    const requestContextService = app.get(RequestContextService);
    const channelService = app.get(ChannelService);
    const roleService = app.get(RoleService);

    const ctxAdmin = await requestContextService.create({
        apiType: 'admin',
    });

    const superAdminRole = await roleService.getSuperAdminRole(ctxAdmin);
    const customerRole = await roleService.getCustomerRole(ctxAdmin);

    for (let i = CHANNEL_COUNT; i > 0; i--) {
        const channel = await channelService.create(ctxAdmin, {
            code: `channel-test-${i}`,
            token: `channel--test-${i}`,
            defaultLanguageCode: LanguageCode.en,
            availableLanguageCodes: [LanguageCode.en],
            pricesIncludeTax: true,
            defaultCurrencyCode: CurrencyCode.USD,
            availableCurrencyCodes: [CurrencyCode.USD],
            sellerId: 1,
            defaultTaxZoneId: 1,
            defaultShippingZoneId: 1,
        });
        if (isGraphQlErrorResult(channel)) {
            console.log(channel.message);
        } else {
            console.log(`Created channel ${channel.code}`);
            await roleService.assignRoleToChannel(ctxAdmin, superAdminRole.id, channel.id);
            await roleService.assignRoleToChannel(ctxAdmin, customerRole.id, channel.id);
        }
    }
}
