import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { SearchIndexItem } from '../plugin/default-search-plugin/entities/search-index-item.entity';

import { HistoryEntry } from './history-entry/history-entry.entity';
import { Region } from './region/region.entity';
import { Session } from './session/session.entity';
import { StockMovement } from './stock-movement/stock-movement.entity';

function indicesFor(target: new (...args: any[]) => any) {
    return getMetadataArgsStorage().indices.filter(index => index.target === target);
}

function hasIndexOn(target: new (...args: any[]) => any, columns: string[]) {
    return indicesFor(target).some(
        index => Array.isArray(index.columns) && index.columns.join() === columns.join(),
    );
}

describe('entity index metadata', () => {
    // These @Index decorators must not be removed. TypeORM's
    // EntityMetadataBuilder.createKeysForTableInheritance() pushes an automatic index for an STI
    // discriminator onto entityMetadata.indices, but computeEntityMetadataStep2() — re-run for
    // every column with a generation strategy, which VendureEntity.id always has — rebuilds that
    // array from ownIndices. For an entity with at least one embedded column (the customFields
    // embed that all four of these have) the rebuild produces a new array, so the automatic index
    // is silently discarded. An explicit @Index is stored in ownIndices and therefore survives.
    it('indexes the HistoryEntry STI discriminator', () => {
        expect(hasIndexOn(HistoryEntry, ['discriminator'])).toBe(true);
    });

    it('indexes the Session STI discriminator', () => {
        expect(hasIndexOn(Session, ['type'])).toBe(true);
    });

    it('indexes the Region STI discriminator', () => {
        expect(hasIndexOn(Region, ['discriminator'])).toBe(true);
    });

    it('indexes the StockMovement STI discriminator', () => {
        expect(hasIndexOn(StockMovement, ['discriminator'])).toBe(true);
    });

    // productId is filtered on directly by the default-search indexer and joined on by the
    // search strategies, and it is not covered by the (productVariantId, languageCode, channelId)
    // primary key or any other index prefix.
    it('indexes SearchIndexItem.productId', () => {
        expect(hasIndexOn(SearchIndexItem, ['productId'])).toBe(true);
    });
});
