import { DeepPartial, ID, Type } from '@vendure/common/lib/shared-types';
import { Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { Channel } from '../channel/channel.entity';
import { EntityId } from '../entity-id.decorator';

/**
 * @description
 * The base class of a channel assignment entity: one row per (entity, Channel), recording that the
 * entity is assigned to the Channel, plus any data that belongs to the entity *in that Channel*.
 *
 * Every {@link ChannelAware} entity has a `channels` many-to-many relation. Its junction table
 * (e.g. `product_channels_channel`) is owned by a channel assignment entity (e.g. `ProductChannel`),
 * so per-channel columns can be added to the junction table without a separate table. The
 * `channels` relation stays as it is, so all the ChannelAware machinery
 * (`ChannelService.assignToChannels()`, `findOneInChannel()`, the ListQueryBuilder `channelId`
 * option) keeps working.
 *
 * Subclasses are declared with the {@link ChannelAssignmentEntity} decorator, and the owning
 * entity's relation must be declared with `@JoinTable({ synchronize: false })`, since the
 * assignment entity manages the table's schema.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
export abstract class ChannelAssignment {
    constructor(input?: DeepPartial<ChannelAssignment>) {
        if (input) {
            Object.assign(this, input);
        }
    }

    channelId: ID;

    channel: Channel;
}

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
 * Declares a channel assignment entity for a {@link ChannelAware} entity. It defines the composite
 * primary key, the relations to the entity and to the Channel, and the indexes, all matching the
 * junction table TypeORM creates for the entity's `channels` many-to-many relation.
 *
 * ```ts
 * \@ChannelAssignmentEntity({
 *     entity: () => Product,
 *     entityProperty: 'product',
 *     tableName: 'product_channels_channel',
 * })
 * export class ProductChannel extends ChannelAssignment {
 *     productId: ID;
 *     product: Product;
 *
 *     \@Column({ type: Boolean, nullable: true, default: null })
 *     enabled: boolean | null;
 * }
 * ```
 *
 * @docsCategory entities
 * @since 4.0.0
 */
export function ChannelAssignmentEntity(options: ChannelAssignmentEntityOptions) {
    return (target: Type<ChannelAssignment>) => {
        const proto = target.prototype;
        const { entityProperty } = options;
        // The key columns must have the same type as the primary keys they reference, as the
        // columns TypeORM creates for a junction table do. Otherwise schema sync keeps finding a
        // difference (e.g. varchar(255) vs varchar(36) for UUIDs on MySQL) and rebuilds them.
        EntityId({ primary: true, matchPrimaryKeyType: true })(proto, `${entityProperty}Id`);
        EntityId({ primary: true, matchPrimaryKeyType: true })(proto, 'channelId');

        JoinColumn()(proto, entityProperty);
        ManyToOne(options.entity, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })(proto, entityProperty);
        Index()(proto, entityProperty);

        JoinColumn()(proto, 'channel');
        ManyToOne(() => Channel, {
            onDelete: 'CASCADE',
            ...(options.channelOnUpdate ? { onUpdate: options.channelOnUpdate } : {}),
        })(proto, 'channel');
        Index()(proto, 'channel');

        Entity(options.tableName)(target);
        registry.set(target, options);
    };
}

/**
 * @description
 * Returns the options of every class declared with {@link ChannelAssignmentEntity}.
 */
export function getChannelAssignmentEntities(): Map<Type<any>, ChannelAssignmentEntityOptions> {
    return registry;
}
