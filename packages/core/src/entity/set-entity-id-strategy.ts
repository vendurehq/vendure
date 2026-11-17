import { Type } from '@vendure/common/lib/shared-types';
import { Column, getMetadataArgsStorage, PrimaryGeneratedColumn } from 'typeorm';

import { EntityIdStrategy } from '../config/entity/entity-id-strategy';

import { getIdColumnsFor, getPrimaryGeneratedIdColumn } from './entity-id.decorator';

export function setEntityIdStrategy(entityIdStrategy: EntityIdStrategy<any>, entities: Array<Type<any>>) {
    setBaseEntityIdType(entityIdStrategy);
    const customFieldClasses = getCustomFieldsClasses(entities);
    setEntityIdColumnTypes(entityIdStrategy, [...entities, ...customFieldClasses]);
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

function setEntityIdColumnTypes(entityIdStrategy: EntityIdStrategy<any>, entities: Array<Type<any>>) {
    // Every @EntityId column holds the primary key of some entity, so it gets the type of that
    // primary key. A column which is also the join column of a relation would get it from TypeORM
    // anyway, but a column without a relation would otherwise differ.
    const isUuid = entityIdStrategy.primaryKeyType === 'uuid';
    for (const EntityCtor of entities) {
        const columnConfig = getIdColumnsFor(EntityCtor);
        for (const { name, options, entity } of columnConfig) {
            Column({
                type: isUuid ? (options?.storeUuidAsVarchar ? 'varchar' : 'uuid') : 'int',
                nullable: (options && options.nullable) || false,
                primary: (options && options.primary) || false,
            })(entity, name);
        }
    }
}

function setBaseEntityIdType(entityIdStrategy: EntityIdStrategy<any>) {
    const { entity, name } = getPrimaryGeneratedIdColumn();
    PrimaryGeneratedColumn(entityIdStrategy.primaryKeyType)(entity, name);
}
