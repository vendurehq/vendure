import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomProductVariantPriceFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { Money } from '../money.decorator';

import { ProductVariant } from './product-variant.entity';

/**
 * @description
 * A ProductVariantPrice is a Channel-specific price for a ProductVariant. For every Channel to
 * which a ProductVariant is assigned, there will be a corresponding ProductVariantPrice entity.
 *
 * @docsCategory entities
 */
@Entity()
export class ProductVariantPrice extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<ProductVariantPrice>) {
        super(input);
    }

    @Money() price: number;

    /**
     * @description
     * The Channel this price applies in. The price is deleted along with the Channel.
     *
     * @since 4.0.0
     */
    @Index()
    @ManyToOne(type => Channel, { onDelete: 'CASCADE' })
    channel: Channel;

    @EntityId({ nullable: true }) channelId: ID;

    @Column('varchar')
    currencyCode: CurrencyCode;

    // `orphanedRowAction: 'disable'`: a priced ProductVariant carries only the prices of the
    // active Channel (`productVariantPrices` is not eager), so saving it must not detach the prices
    // of its other Channels. Prices are removed by deleting them, so nothing needs the nullify.
    @Index()
    @ManyToOne(type => ProductVariant, variant => variant.productVariantPrices, {
        onDelete: 'CASCADE',
        orphanedRowAction: 'disable',
    })
    variant: ProductVariant;

    /**
     * @description
     * The id of the ProductVariant this price belongs to.
     *
     * @since 4.0.0
     */
    @EntityId({ nullable: true })
    variantId: ID;

    @Column(type => CustomProductVariantPriceFields)
    customFields: CustomProductVariantPriceFields;
}
