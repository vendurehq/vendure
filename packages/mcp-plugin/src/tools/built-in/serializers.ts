import { ID, Product } from '@vendure/core';

export function productSummary(
    product: (Product & { name?: string; slug?: string; description?: string }) | undefined | null,
) {
    if (!product) return null;
    return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        enabled: product.enabled,
        featuredAsset: product.featuredAsset ? assetSummary(product.featuredAsset) : null,
    };
}

export function collectionSummary(
    collection:
        | { id: ID; name?: string; slug?: string; description?: string; featuredAsset?: unknown }
        | undefined
        | null,
) {
    if (!collection) return null;
    return {
        id: collection.id,
        name: collection.name,
        slug: collection.slug,
        description: collection.description,
        featuredAsset: collection.featuredAsset ? assetSummary(collection.featuredAsset) : null,
    };
}

export function customerSummary(
    customer:
        | { id?: ID; firstName?: string; lastName?: string; emailAddress?: string; phoneNumber?: string }
        | undefined
        | null,
) {
    if (!customer || !('id' in customer)) return null;
    return {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        emailAddress: customer.emailAddress,
        phoneNumber: customer.phoneNumber,
    };
}

export function customerSummaryResult(customer: unknown) {
    if (isRecord(customer) && '__typename' in customer && 'message' in customer) {
        return null;
    }
    return customerSummary(
        customer as
            | {
                  id?: ID;
                  firstName?: string;
                  lastName?: string;
                  emailAddress?: string;
                  phoneNumber?: string;
              }
            | undefined
            | null,
    );
}

export function assetSummary(asset: unknown) {
    if (!isRecord(asset)) return null;
    return {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        fileSize: asset.fileSize,
        source: asset.source,
        preview: asset.preview,
        focalPoint: asset.focalPoint,
        tags: Array.isArray(asset.tags)
            ? asset.tags.map(tag => (isRecord(tag) ? tag.value : tag))
            : undefined,
    };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
