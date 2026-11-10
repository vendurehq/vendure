import { Type } from '@vendure/common/lib/shared-types';
import { Column, getMetadataArgsStorage, PrimaryGeneratedColumn } from 'typeorm';

import { EntityIdStrategy } from '../config/entity/entity-id-strategy';
import { VendureDatabaseType } from '../connection/database-type';

import { getIdColumnsFor, getPrimaryGeneratedIdColumn } from './entity-id.decorator';

export function setEntityIdStrategy(
    entityIdStrategy: EntityIdStrategy<any>,
    entities: Array<Type<any>>,
    dbType?: VendureDatabaseType,
) {
    setBaseEntityIdType(entityIdStrategy);
    const customFieldClasses = getCustomFieldsClasses(entities);
    setEntityIdColumnTypes(entityIdStrategy, [...entities, ...customFieldClasses], dbType);
}

/**
 * Custom field relation id columns are registered on the embedded CustomFields classes
 * (e.g. CustomProductFields) rather than on the entities themselves, so those classes
 * also need to be included when resolving the id column data types.
 */
function getCustomFieldsClasses(entities: Array<Type<any>>): Array<Type<any>> {
    const metadataArgsStorage = getMetadataArgsStorage();
    const customFieldClasses: Array<Type<any>> = [];
    for (const EntityCtor of entities) {
        const embeddedMetadata = metadataArgsStorage.embeddeds.find(item => {
            if (item.propertyName !== 'customFields') {
                return false;
            }
            const targetName = typeof item.target === 'string' ? item.target : item.target.name;
            return targetName === EntityCtor.name;
        });
        const customFieldsClass = embeddedMetadata?.type();
        if (customFieldsClass && typeof customFieldsClass !== 'string') {
            customFieldClasses.push(customFieldsClass as Type<any>);
        }
    }
    return customFieldClasses;
}

function setEntityIdColumnTypes(
    entityIdStrategy: EntityIdStrategy<any>,
    entities: Array<Type<any>>,
    dbType?: VendureDatabaseType,
) {
    const columnDataType = entityIdStrategy.primaryKeyType === 'increment' ? 'int' : 'varchar';
    for (const EntityCtor of entities) {
        const columnConfig = getIdColumnsFor(EntityCtor);
        for (const { name, options, entity } of columnConfig) {
            Column({
                ...(options?.matchPrimaryKeyType && entityIdStrategy.primaryKeyType === 'uuid'
                    ? matchingUuidColumnOptions(dbType)
                    : { type: columnDataType }),
                nullable: (options && options.nullable) || false,
                primary: (options && options.primary) || false,
            })(entity, name);
        }
    }
}

/**
 * The options of a column which must match a UUID primary key exactly, as TypeORM derives the
 * columns of a junction table: TypeORM copies the referenced type onto an explicit join column,
 * but not its length, and on MySQL a UUID key is stored as varchar(36) (MySQL has no native uuid
 * type). MariaDB 10.7+ has a native uuid type, which takes no length.
 */
function matchingUuidColumnOptions(dbType?: VendureDatabaseType) {
    return dbType === 'mysql' || dbType === 'aurora-mysql'
        ? { type: 'uuid' as const, length: 36 }
        : { type: 'uuid' as const };
}

function setBaseEntityIdType(entityIdStrategy: EntityIdStrategy<any>) {
    const { entity, name } = getPrimaryGeneratedIdColumn();
    PrimaryGeneratedColumn(entityIdStrategy.primaryKeyType)(entity, name);
}
