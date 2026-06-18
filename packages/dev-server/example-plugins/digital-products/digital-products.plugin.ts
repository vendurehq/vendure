import { LanguageCode, PluginCommonModule, VendurePlugin } from '@vendure/core';

import './types';
import { digitalFulfillmentHandler } from './config/digital-fulfillment-handler';
import { digitalOrderProcess } from './config/digital-order-process';
import { digitalShippingEligibilityChecker } from './config/digital-shipping-eligibility-checker';
import { DigitalShippingLineAssignmentStrategy } from './config/digital-shipping-line-assignment-strategy';

/**
 * @description
 * This is an example plugin which demonstrates how to add support for digital products.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        config.customFields.ProductVariant.push({
            type: 'boolean',
            name: 'isDigital',
            defaultValue: false,
            label: [{ languageCode: LanguageCode.en, value: 'This product is digital' }],
            public: true,
        });
        config.customFields.ShippingMethod.push({
            type: 'boolean',
            name: 'isDigital',
            defaultValue: false,
            label: [
                { languageCode: LanguageCode.en, value: 'This shipping method handles digital products' },
            ],
            public: true,
        });
        config.customFields.Fulfillment.push({
            type: 'string',
            name: 'downloadUrls',
            nullable: true,
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Urls of any digital purchases' }],
            public: true,
        });
        config.shippingOptions.fulfillmentHandlers.push(digitalFulfillmentHandler);
        config.shippingOptions.shippingLineAssignmentStrategy = new DigitalShippingLineAssignmentStrategy();
        config.shippingOptions.shippingEligibilityCheckers.push(digitalShippingEligibilityChecker);
        config.orderOptions.process.push(digitalOrderProcess);
        return config;
    },
    compatibility: '^3.0.0',
})
export class DigitalProductsPlugin {}
