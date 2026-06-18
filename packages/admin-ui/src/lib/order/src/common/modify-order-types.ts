import {
    AddItemInput,
    CurrencyCode,
    ModifyOrderInput,
    OrderDetailFragment,
    OrderLineInput,
    ProductSelectorSearchQuery,
} from '@vendure/admin-ui/core';

export interface OrderSnapshot {
    totalWithTax: number;
    currencyCode: CurrencyCode;
    couponCodes: string[];
    lines: OrderDetailFragment['lines'];
    shippingLines: OrderDetailFragment['shippingLines'];
}

export type ProductSelectorItem = ProductSelectorSearchQuery['search']['items'][number];

export interface AddedLine {
    id: string;
    featuredAsset?: ProductSelectorItem['productAsset'] | null;
    productVariant: {
        id: string;
        name: string;
        sku: string;
    };
    unitPrice: number;
    unitPriceWithTax: number;
    quantity: number;
}

export type ModifyOrderData = Omit<ModifyOrderInput, 'addItems' | 'adjustOrderLines'> & {
    addItems: Array<AddItemInput & { customFields?: any }>;
    adjustOrderLines: Array<OrderLineInput & { customFields?: any }>;
};
