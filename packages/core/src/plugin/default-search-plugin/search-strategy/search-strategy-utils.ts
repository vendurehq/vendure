import {
    Coordinate,
    CurrencyCode,
    LanguageCode,
    PriceRange,
    SearchResult,
    SearchResultAsset,
    SinglePrice,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { Brackets, QueryBuilder, SelectQueryBuilder } from 'typeorm';

import { SearchIndexItem } from '../entities/search-index-item.entity';

/**
 * Maps a raw database result to a SearchResult.
 */
export function mapToSearchResult(raw: any, currencyCode: CurrencyCode): SearchResult {
    const price =
        raw.minPrice !== undefined
            ? ({ min: raw.minPrice, max: raw.maxPrice } as PriceRange)
            : ({ value: raw.si_price } as SinglePrice);
    const priceWithTax =
        raw.minPriceWithTax !== undefined
            ? ({ min: raw.minPriceWithTax, max: raw.maxPriceWithTax } as PriceRange)
            : ({ value: raw.si_priceWithTax } as SinglePrice);

    const productAsset: SearchResultAsset | undefined = !raw.si_productAssetId
        ? undefined
        : {
              id: raw.si_productAssetId,
              preview: raw.si_productPreview,
              focalPoint: parseFocalPoint(raw.si_productPreviewFocalPoint),
          };
    const productVariantAsset: SearchResultAsset | undefined = !raw.si_productVariantAssetId
        ? undefined
        : {
              id: raw.si_productVariantAssetId,
              preview: raw.si_productVariantPreview,
              focalPoint: parseFocalPoint(raw.si_productVariantPreviewFocalPoint),
          };

    const enabled = raw.productEnabled != null ? !!Number(raw.productEnabled) : raw.si_enabled;
    return {
        sku: raw.si_sku,
        slug: raw.si_slug,
        price,
        enabled,
        priceWithTax,
        currencyCode,
        productVariantId: raw.si_productVariantId,
        productId: raw.si_productId,
        productName: raw.si_productName,
        productVariantName: raw.si_productVariantName,
        description: raw.si_description,
        facetIds: raw.si_facetIds.split(',').map((x: string) => x.trim()),
        facetValueIds: raw.si_facetValueIds.split(',').map((x: string) => x.trim()),
        collectionIds: raw.si_collectionIds.split(',').map((x: string) => x.trim()),
        channelIds: raw.si_channelIds.split(',').map((x: string) => x.trim()),
        productAsset,
        productVariantAsset,
        score: raw.score || 0,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        inStock: raw.si_inStock,
    };
}

/**
 * Given the raw query results containing rows with a `facetValues` property line "1,2,1,2",
 * this function returns a map of FacetValue ids => count of how many times they occur.
 */
export function createFacetIdCountMap(facetValuesResult: Array<{ facetValues: string }>) {
    const result = new Map<ID, number>();
    for (const res of facetValuesResult) {
        const facetValueIds: ID[] = unique(res.facetValues.split(',').filter(x => x !== ''));
        for (const id of facetValueIds) {
            const count = result.get(id);
            const newCount = count ? count + 1 : 1;
            result.set(id, newCount);
        }
    }
    return result;
}

/**
 * Given the raw query results containing rows with a `collections` property line "1,2,1,2",
 * this function returns a map of Collection ids => count of how many times they occur.
 */
export function createCollectionIdCountMap(collectionsResult: Array<{ collections: string }>) {
    const result = new Map<ID, number>();
    for (const res of collectionsResult) {
        const collectionIds: ID[] = unique(res.collections.split(',').filter(x => x !== ''));
        for (const id of collectionIds) {
            const count = result.get(id);
            const newCount = count ? count + 1 : 1;
            result.set(id, newCount);
        }
    }
    return result;
}

function parseFocalPoint(focalPoint: any): Coordinate | undefined {
    if (focalPoint && typeof focalPoint === 'string') {
        try {
            return JSON.parse(focalPoint);
        } catch (e: any) {
            // fall though
        }
    }
    return;
}

export function createPlaceholderFromId(id: ID): string {
    return '_' + id.toString().replace(/-/g, '_');
}

/**
 * Applies language constraints for {@link SearchIndexItem} query.
 *
 * @param qb QueryBuilder instance
 * @param languageCode Preferred language code
 * @param defaultLanguageCode Default language code that is used if {@link SearchIndexItem} is not available in preferred language
 */
export function applyLanguageConstraints(
    qb: SelectQueryBuilder<SearchIndexItem>,
    languageCode: LanguageCode,
    defaultLanguageCode: LanguageCode,
) {
    const lcEscaped = qb.escape('languageCode');
    const ciEscaped = qb.escape('channelId');
    const pviEscaped = qb.escape('productVariantId');

    if (languageCode === defaultLanguageCode) {
        qb.andWhere(`si.${lcEscaped} = :languageCode`, {
            languageCode,
        });
    } else {
        qb.andWhere(`si.${lcEscaped} IN (:...languageCodes)`, {
            languageCodes: [languageCode, defaultLanguageCode],
        });

        qb.leftJoin(
            SearchIndexItem,
            'sil',
            `sil.${lcEscaped} = :languageCode AND sil.${ciEscaped} = si.${ciEscaped} AND sil.${pviEscaped} = si.${pviEscaped}`,
            {
                languageCode,
            },
        );

        qb.andWhere(
            new Brackets(qb1 => {
                qb1.where(`si.${lcEscaped} = :languageCode1`, {
                    languageCode1: languageCode,
                }).orWhere(`sil.${lcEscaped} IS NULL`);
            }),
        );
    }

    return qb;
}
