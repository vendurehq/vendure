import { Type } from '@vendure/common/lib/shared-types';
import { Column, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

import { EntityIdStrategy } from '../config/entity/entity-id-strategy';

import { getIdColumnsFor, getPrimaryGeneratedIdColumn } from './entity-id.decorator';

export function setEntityIdStrategy(entityIdStrategy: EntityIdStrategy<any>, entities: Array<Type<any>>) {
    setBaseEntityIdType(entityIdStrategy);
    setEntityIdColumnTypes(entityIdStrategy, entities);
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
