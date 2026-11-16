import { DeepPartial, ID, Type } from '@vendure/common/lib/shared-types';
import { Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { Channel } from '../channel/channel.entity';
import { EntityId } from '../entity-id.decorator';

import { ChannelAssignmentEntityOptions, getChannelAssignmentEntities } from './channel-assignment-registry';

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
 * Per-channel columns should be nullable or have a default. `ChannelService.assignToChannels()`
 * copies them from an existing assignment of the entity, but assignments created in other ways
 * (`ChannelService.assignToCurrentChannel()`, saving `entity.channels`, the FastImporterService)
 * start with the column defaults.
 *
 * Relations are only supported inside the `customFields` of an assignment entity.
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
        // The key columns get the type of the primary keys they reference, as the columns TypeORM
        // creates for a junction table do (see alignChannelAssignmentMetadata() for the length).
        EntityId({ primary: true })(proto, `${entityProperty}Id`);
        EntityId({ primary: true })(proto, 'channelId');

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
        getChannelAssignmentEntities().set(target, options);
    };
}

export { ChannelAssignmentEntityOptions, getChannelAssignmentEntities } from './channel-assignment-registry';
