import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';

import type { RequestContext } from '../../api/common/request-context';
import { ChannelAware, SoftDeletable } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { Asset } from '../asset/asset.entity';
import { VendureEntity } from '../base/base.entity';
import {
    ChannelCustomFieldsOptions,
    readChannelCustomFields,
} from '../channel-assignment/channel-custom-fields';
import { Channel } from '../channel/channel.entity';
import { CustomProductChannelFields, CustomProductFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { FacetValue } from '../facet-value/facet-value.entity';
import { ProductOptionGroup } from '../product-option-group/product-option-group.entity';
import { ProductVariant } from '../product-variant/product-variant.entity';

import { ProductAsset } from './product-asset.entity';
import { ProductTranslation } from './product-translation.entity';

/**
 * @description
 * A Product contains one or more {@link ProductVariant}s and serves as a container for those variants,
 * providing an overall name, description etc.
 *
 * @docsCategory entities
 */
@Entity()
export class Product
    extends VendureEntity
    implements Translatable, HasCustomFields, ChannelAware, SoftDeletable
{
    constructor(input?: DeepPartial<Product>) {
        super(input);
    }

    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    name: LocaleString;

    slug: LocaleString;

    description: LocaleString;

    @Column({ default: true })
    enabled: boolean;

    @Index()
    @ManyToOne(type => Asset, asset => asset.featuredInProducts, { onDelete: 'SET NULL' })
    featuredAsset: Asset;

    @EntityId({ nullable: true })
    featuredAssetId: ID;

    @OneToMany(type => ProductAsset, productAsset => productAsset.product)
    assets: ProductAsset[];

    @OneToMany(type => ProductTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<Product>>;

    @OneToMany(type => ProductVariant, variant => variant.product)
    variants: ProductVariant[];

    @ManyToMany(type => ProductOptionGroup, optionGroup => optionGroup.products)
    @JoinTable()
    optionGroups: ProductOptionGroup[];

    @ManyToMany(type => FacetValue, facetValue => facetValue.products)
    @JoinTable()
    facetValues: FacetValue[];

    @ManyToMany(type => Channel, channel => channel.products)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];

    @Column(type => CustomProductFields)
    customFields: CustomProductFields;

    /**
     * @description
     * Returns the values of the Product's `channelScoped` custom fields in the active Channel of
     * the RequestContext (or `options.channelId`), or `undefined` if the Product is not assigned to
     * that Channel. They are not part of `customFields`, since they have a value per Channel.
     * Declare their types on {@link CustomProductChannelFields}.
     *
     * Relation fields are only set if listed in `options.relations`. Calls without relations made
     * in the same tick are batched into one query.
     *
     * @example
     * ```ts
     * const channelFields = await product.getChannelCustomFields(ctx);
     * const note = channelFields?.channelNote;
     * ```
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomProductChannelFields>,
    ): Promise<CustomProductChannelFields | undefined> {
        return readChannelCustomFields(ctx, Product, this, options);
    }
}
