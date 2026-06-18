export const fieldsToSelect = [
    'sku',
    'enabled',
    'slug',
    'price',
    'priceWithTax',
    'productVariantId',
    'languageCode',
    'productId',
    'productName',
    'productVariantName',
    'description',
    'facetIds',
    'facetValueIds',
    'collectionIds',
    'channelIds',
    'productAssetId',
    'productPreview',
    'productPreviewFocalPoint',
    'productVariantAssetId',
    'productVariantPreview',
    'productVariantPreviewFocalPoint',
];

export function getFieldsToSelect(includeStockStatus: boolean = false, includeCurrencyCode: boolean = false) {
    const _fieldsToSelect = [...fieldsToSelect];
    if (includeStockStatus) {
        _fieldsToSelect.push('inStock');
    }
    if (includeCurrencyCode) {
        _fieldsToSelect.push('currencyCode');
    }
    return _fieldsToSelect;
}
