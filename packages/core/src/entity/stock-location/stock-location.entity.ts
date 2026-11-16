import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

import type { RequestContext } from '../../api/common/request-context';
import { ChannelAware } from '../../common/types/common-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import {
    ChannelCustomFieldsOptions,
    readChannelCustomFields,
} from '../channel-assignment/channel-custom-fields';
import { Channel } from '../channel/channel.entity';
import { CustomStockLocationChannelFields, CustomStockLocationFields } from '../custom-entity-fields';
import { StockMovement } from '../stock-movement/stock-movement.entity';

/**
 * @description
 * A StockLocation represents a physical location where stock is held. For example, a warehouse or a shop.
 *
 * When the stock of a {@link ProductVariant} is adjusted, the adjustment is applied to a specific StockLocation,
 * and the stockOnHand of that ProductVariant is updated accordingly. When there are multiple StockLocations
 * configured, the {@link StockLocationStrategy} is used to determine which StockLocation should be used for
 * a given operation.
 *
 * @docsCategory entities
 */
@Entity()
export class StockLocation extends VendureEntity implements HasCustomFields, ChannelAware {
    constructor(input: DeepPartial<StockLocation>) {
        super(input);
    }
    @Column()
    name: string;

    @Column()
    description: string;

    @Column(type => CustomStockLocationFields)
    customFields: CustomStockLocationFields;

    /**
     * @description
     * Returns the values of the StockLocation's channel-scoped custom fields in the active Channel of
     * the RequestContext (or `options.channelId`), or `undefined` if the StockLocation is not assigned to
     * that Channel. They are not part of `customFields`, since they have a value per Channel.
     * Declare their types on {@link CustomStockLocationChannelFields}.
     *
     * Relation fields are only set if listed in `options.relations`. Calls without relations made
     * in the same tick are batched into one query.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomStockLocationChannelFields>,
    ): Promise<CustomStockLocationChannelFields | undefined> {
        return readChannelCustomFields(ctx, StockLocation, this, options);
    }

    @ManyToMany(type => Channel, channel => channel.stockLocations)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];

    @OneToMany(type => StockMovement, movement => movement.stockLocation)
    stockMovements: StockMovement[];
}
