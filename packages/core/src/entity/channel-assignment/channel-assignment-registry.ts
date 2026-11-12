import { Type } from '@vendure/common/lib/shared-types';

// Kept free of entity imports, so that code which only needs the registry (e.g. DataSource
// initialization) doesn't load the entity graph.

export interface ChannelAssignmentEntityOptions {
    /**
     * The ChannelAware entity which is assigned to Channels.
     */
    entity: () => Type<any>;
    /**
     * The property name of the relation to the entity. The id column is this name + `Id`,
     * e.g. `product` → `productId`, matching the junction table's column under the default
     * naming strategy.
     */
    entityProperty: string;
    /**
     * The junction table of the entity's `channels` relation.
     */
    tableName: string;
    /**
     * The `ON UPDATE` action of the junction table's foreign key to `channel`. TypeORM derives it
     * from the inverse relation's options, so it differs between entities.
     *
     * @default 'NO ACTION'
     */
    channelOnUpdate?: 'CASCADE' | 'NO ACTION';
}

const registry = new Map<Type<any>, ChannelAssignmentEntityOptions>();

/**
 * @description
 * Returns the options of every class declared with `@ChannelAssignmentEntity()`, keyed by class.
 */
export function getChannelAssignmentEntities(): Map<Type<any>, ChannelAssignmentEntityOptions> {
    return registry;
}
