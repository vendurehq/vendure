import {
    CustomProductVariantFields,
    CustomFulfillmentFields,
    CustomShippingMethodFields,
} from '@vendure/core/dist/entity/custom-entity-fields';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductVariantFields {
        isDigital: boolean;
    }
    interface CustomShippingMethodFields {
        isDigital: boolean;
    }
    interface CustomFulfillmentFields {
        downloadUrls: string[] | null;
    }
}
