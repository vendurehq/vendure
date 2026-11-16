import { Type } from '@vendure/common/lib/shared-types';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureConfigLoaded } from '../config/config-helpers';
import { UuidIdStrategy } from '../config/entity/uuid-id-strategy';
import { SearchIndexItem } from '../plugin/default-search-plugin/entities/search-index-item.entity';

import { coreEntitiesMap } from './entities';
import { getIdColumnsFor } from './entity-id.decorator';
import { setEntityIdStrategy } from './set-entity-id-strategy';

// Cast as in getAllEntities(): several core entities are abstract STI bases.
const coreEntities = Object.values(coreEntitiesMap) as Array<Type<any>>;
const entities = [...coreEntities, SearchIndexItem];

/**
 * #2318: an @EntityId column without a relation fell back to `varchar` under the UUID strategy,
 * and two of them (order.taxZoneId, product_variant_price.channelId) had no foreign key.
 * The decorators are applied once per process, so this file only covers the UUID strategy; the
 * e2e suites run with the auto-increment strategy.
 */
describe('setEntityIdStrategy()', () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        await ensureConfigLoaded();
        setEntityIdStrategy(new UuidIdStrategy(), entities);
        dataSource = new DataSource({ type: 'sqljs', entities });
        await dataSource.initialize();
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    const columnTypes = (filter: (options?: { storeUuidAsVarchar?: boolean }) => boolean) =>
        entities.flatMap(entity =>
            getIdColumnsFor(entity)
                .filter(({ options }) => filter(options))
                .map(({ name }) => [
                    `${entity.name}.${name}`,
                    dataSource.getMetadata(entity).findColumnWithPropertyName(name)?.type,
                ]),
        );

    it('gives every @EntityId column the uuid type', () => {
        const columns = columnTypes(options => !options?.storeUuidAsVarchar);
        expect(columns.length).toBeGreaterThan(0);
        expect(columns.filter(([, type]) => type !== 'uuid')).toEqual([]);
    });

    it('keeps varchar for columns with storeUuidAsVarchar, such as the search index', () => {
        const columns = columnTypes(options => !!options?.storeUuidAsVarchar);
        expect(columns.map(([name]) => name)).toContain('SearchIndexItem.productVariantId');
        expect(columns.filter(([, type]) => type !== 'varchar')).toEqual([]);
    });

    // The search index is a denormalized copy which is rebuilt from the catalog, so its id
    // columns deliberately have no foreign keys.
    it('gives every @EntityId column of a core entity a foreign key', () => {
        // With single table inheritance, TypeORM records the foreign keys of a child entity's
        // relations on the metadata of the parent, so they are collected per table.
        const foreignKeyColumns = (tableName: string) =>
            dataSource.entityMetadatas
                .filter(m => m.tableName === tableName)
                .flatMap(m => m.foreignKeys.flatMap(fk => fk.columnNames));
        const missing = coreEntities.flatMap(entity => {
            const metadata = dataSource.getMetadata(entity);
            const fkColumns = foreignKeyColumns(metadata.tableName);
            return getIdColumnsFor(entity)
                .map(({ name }) => metadata.findColumnWithPropertyName(name)?.databaseName ?? name)
                .filter(column => !fkColumns.includes(column))
                .map(column => `${metadata.tableName}.${column}`);
        });
        expect(missing).toEqual([]);
    });

    it('sets order.taxZoneId to NULL when the Zone is deleted', () => {
        const fk = dataSource.getMetadata('Order').foreignKeys.find(f => f.columnNames.includes('taxZoneId'));
        expect(fk?.referencedEntityMetadata.tableName).toBe('zone');
        expect(fk?.onDelete).toBe('SET NULL');
    });

    it('deletes a product_variant_price along with its Channel', () => {
        const fk = dataSource
            .getMetadata('ProductVariantPrice')
            .foreignKeys.find(f => f.columnNames.includes('channelId'));
        expect(fk?.referencedEntityMetadata.tableName).toBe('channel');
        expect(fk?.onDelete).toBe('CASCADE');
    });
});
