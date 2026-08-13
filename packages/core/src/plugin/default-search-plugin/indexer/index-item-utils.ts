import { SearchIndexItem } from '../entities/search-index-item.entity';

/**
 * Deduplicates the given SearchIndexItems by their composite primary key, keeping the last
 * occurrence of each key. The primary key properties are passed in rather than hard-coded
 * because the primary key of the SearchIndexItem entity is dynamic: the `indexCurrencyCode`
 * option of the DefaultSearchPlugin adds `currencyCode` as a fourth primary column.
 *
 * Deduplication is a prerequisite for persisting a batch with `upsert()`: postgres rejects
 * an INSERT ... ON CONFLICT DO UPDATE statement which affects the same row more than once.
 */
export function dedupeSearchIndexItems(
    items: SearchIndexItem[],
    primaryKeyProperties: string[],
): SearchIndexItem[] {
    const itemsByPrimaryKey = new Map<string, SearchIndexItem>();
    for (const item of items) {
        const primaryKey = primaryKeyProperties
            .map(property => String(item[property as keyof SearchIndexItem]))
            .join(':');
        itemsByPrimaryKey.set(primaryKey, item);
    }
    return Array.from(itemsByPrimaryKey.values());
}
