import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';

import type { RequestContext } from '../../api/common/request-context';
import { ChannelAware } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import {
    ChannelCustomFieldsOptions,
    readChannelCustomFields,
} from '../channel-assignment/channel-custom-fields';
import { Channel } from '../channel/channel.entity';
import { CustomFacetValueChannelFields, CustomFacetValueFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { Facet } from '../facet/facet.entity';
import { ProductVariant } from '../product-variant/product-variant.entity';
import { Product } from '../product/product.entity';

import { FacetValueTranslation } from './facet-value-translation.entity';

/**
 * @description
 * A particular value of a {@link Facet}.
 *
 * @docsCategory entities
 */
@Entity()
export class FacetValue extends VendureEntity implements Translatable, HasCustomFields, ChannelAware {
    constructor(input?: DeepPartial<FacetValue>) {
        super(input);
    }
    name: LocaleString;

    @Column() code: string;

    @OneToMany(type => FacetValueTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<FacetValue>>;

    @Index()
    @ManyToOne(type => Facet, group => group.values, { onDelete: 'CASCADE' })
    facet: Facet;

    @EntityId()
    facetId: ID;

    @Column(type => CustomFacetValueFields)
    customFields: CustomFacetValueFields;

    /**
     * @description
     * Returns the values of the FacetValue's channel-scoped custom fields in the active Channel of
     * the RequestContext (or `options.channelId`), or `undefined` if the FacetValue is not assigned to
     * that Channel. They are not part of `customFields`, since they have a value per Channel.
     * Declare their types on {@link CustomFacetValueChannelFields}.
     *
     * Relation fields are only set if listed in `options.relations`. Calls without relations made
     * in the same tick are batched into one query.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomFacetValueChannelFields>,
    ): Promise<CustomFacetValueChannelFields | undefined> {
        return readChannelCustomFields(ctx, FacetValue, this, options);
    }

    @ManyToMany(type => Channel, channel => channel.facetValues)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];

    // Declared explicitly: TypeORM 1.1.1+ defaults an undeclared inverse junction FK rule to CASCADE (#5594).
    @ManyToMany(() => Product, product => product.facetValues, { onDelete: 'CASCADE', onUpdate: 'NO ACTION' })
    products: Product[];

    @ManyToMany(type => ProductVariant, productVariant => productVariant.facetValues, {
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
    })
    productVariants: ProductVariant[];
}
