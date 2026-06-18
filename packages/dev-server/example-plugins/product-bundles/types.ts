import { ID } from '@vendure/common/lib/shared-types';

export type CreateProductBundleInput = {
    name: string;
    description: string;
};

export type UpdateProductBundleInput = {
    id: ID;
    name?: string;
    description?: string;
};

export type CreateProductBundleItemInput = {
    bundleId: ID;
    productVariantId: ID;
    price: number;
    quantity: number;
};

export type UpdateProductBundleItemInput = {
    id: ID;
    price?: number;
    quantity?: number;
};

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderLineFields {
        fromBundle: {
            bundleId: string;
            bundleName: string;
            bundleInstanceId: string;
        };
    }
}
