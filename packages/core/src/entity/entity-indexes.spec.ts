import { Type } from '@vendure/common/lib/shared-types';
import { DataSource, Table } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureConfigLoaded } from '../config/config-helpers';
import { AutoIncrementIdStrategy } from '../config/entity/auto-increment-id-strategy';
import { SearchIndexItem } from '../plugin/default-search-plugin/entities/search-index-item.entity';

import { coreEntitiesMap } from './entities';
import { setEntityIdStrategy } from './set-entity-id-strategy';

// Cast as in getAllEntities(): several core entities are abstract STI bases.
const entities = [...Object.values(coreEntitiesMap), SearchIndexItem] as Array<Type<any>>;

/**
 * TypeORM's EntityMetadataBuilder creates an index for every STI discriminator, but
 * computeEntityMetadataStep2() then rebuilds entityMetadata.indices from ownIndices and discards it
 * again for any entity with an embedded column — which is every STI base carrying a `customFields`
 * embed. An explicit `@Index` is recorded in ownIndices and survives, so the first five columns
 * below depend on one. The last two are STI bases without that embed: they keep their automatic
 * index with no `@Index` of their own, so their passing shows these assertions read the schema
 * TypeORM emits rather than the decorator metadata.
 */
const singlyIndexedColumns = [
    ['history_entry', 'discriminator'],
    ['region', 'discriminator'],
    ['session', 'type'],
    ['stock_movement', 'discriminator'],
    ['search_index_item', 'productId'],
    ['authentication_method', 'type'],
    ['order_line_reference', 'discriminator'],
] as const;

describe('entity indexes', () => {
    let dataSource: DataSource;
    let tables: Table[];

    beforeAll(async () => {
        await ensureConfigLoaded();
        setEntityIdStrategy(new AutoIncrementIdStrategy(), entities);
        // sqljs stands in for the supported databases here: indices are resolved by
        // EntityMetadataBuilder before any driver sees them, and none of the columns above is a
        // relation, so no driver-specific foreign key indexes are in play.
        dataSource = new DataSource({ type: 'sqljs', entities, synchronize: true });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        tables = await queryRunner.getTables();
        await queryRunner.release();
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    // Only an index with the column in leading position can serve a predicate on that column, and a
    // second such index would be redundant.
    it.each(singlyIndexedColumns)('indexes %s.%s exactly once', (tableName, column) => {
        const table = tables.find(t => t.name === tableName);
        expect(table?.indices.filter(index => index.columnNames[0] === column)).toHaveLength(1);
    });
});
