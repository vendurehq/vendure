import { Type } from '@vendure/common/lib/shared-types';
import { Column, getMetadataArgsStorage, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

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
    const columnDataType = entityIdStrategy.primaryKeyType === 'increment' ? 'int' : 'varchar';
    for (const EntityCtor of entities) {
        const columnConfig = getIdColumnsFor(EntityCtor);
        for (const { name, options, entity } of columnConfig) {
            Column({
                type: columnDataType,
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
