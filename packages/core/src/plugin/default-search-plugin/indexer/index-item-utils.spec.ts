import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { SearchIndexItem } from '../entities/search-index-item.entity';

import { dedupeSearchIndexItems } from './index-item-utils';

describe('dedupeSearchIndexItems()', () => {
    const threeColumnPk = ['productVariantId', 'languageCode', 'channelId'];
    const fourColumnPk = [...threeColumnPk, 'currencyCode'];

    it('returns an empty array for empty input', () => {
        expect(dedupeSearchIndexItems([], threeColumnPk)).toEqual([]);
    });

    it('keeps items with distinct primary keys', () => {
        const items = [
            new SearchIndexItem({ productVariantId: 1, languageCode: LanguageCode.en, channelId: 1 }),
            new SearchIndexItem({ productVariantId: 2, languageCode: LanguageCode.en, channelId: 1 }),
            new SearchIndexItem({ productVariantId: 1, languageCode: LanguageCode.de, channelId: 1 }),
            new SearchIndexItem({ productVariantId: 1, languageCode: LanguageCode.en, channelId: 2 }),
        ];

        expect(dedupeSearchIndexItems(items, threeColumnPk)).toEqual(items);
    });

    it('keeps only the last occurrence of a duplicated primary key', () => {
        const first = new SearchIndexItem({
            productVariantId: 1,
            languageCode: LanguageCode.en,
            channelId: 1,
            productName: 'stale',
        });
        const second = new SearchIndexItem({
            productVariantId: 1,
            languageCode: LanguageCode.en,
            channelId: 1,
            productName: 'fresh',
        });

        expect(dedupeSearchIndexItems([first, second], threeColumnPk)).toEqual([second]);
    });

    it('collapses synthetic variant items sharing productVariantId 0', () => {
        const productA = new SearchIndexItem({
            productVariantId: 0,
            languageCode: LanguageCode.en,
            channelId: 1,
            productId: 1,
        });
        const productB = new SearchIndexItem({
            productVariantId: 0,
            languageCode: LanguageCode.en,
            channelId: 1,
            productId: 2,
        });

        expect(dedupeSearchIndexItems([productA, productB], threeColumnPk)).toEqual([productB]);
    });

    it('treats currencyCode as part of the key only when it is a primary key property', () => {
        const usdItem = new SearchIndexItem({
            productVariantId: 1,
            languageCode: LanguageCode.en,
            channelId: 1,
            currencyCode: CurrencyCode.USD,
        });
        const gbpItem = new SearchIndexItem({
            productVariantId: 1,
            languageCode: LanguageCode.en,
            channelId: 1,
            currencyCode: CurrencyCode.GBP,
        });

        expect(dedupeSearchIndexItems([usdItem, gbpItem], fourColumnPk)).toEqual([usdItem, gbpItem]);
        expect(dedupeSearchIndexItems([usdItem, gbpItem], threeColumnPk)).toEqual([gbpItem]);
    });
});
