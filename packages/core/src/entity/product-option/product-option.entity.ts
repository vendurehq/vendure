import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';

import type { RequestContext } from '../../api/common/request-context';
import { ChannelAware, SoftDeletable } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import {
    ChannelCustomFieldsOptions,
    readChannelCustomFields,
} from '../channel-assignment/channel-custom-fields';
import { Channel } from '../channel/channel.entity';
import { CustomProductOptionChannelFields, CustomProductOptionFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { ProductOptionGroup } from '../product-option-group/product-option-group.entity';
import { ProductVariant } from '../product-variant/product-variant.entity';

import { ProductOptionTranslation } from './product-option-translation.entity';

/**
 * @description
 * A ProductOption is used to differentiate {@link ProductVariant}s from one another.
 *
 * @docsCategory entities
 */
@Entity()
export class ProductOption
    extends VendureEntity
    implements Translatable, HasCustomFields, SoftDeletable, ChannelAware
{
    constructor(input?: DeepPartial<ProductOption>) {
        super(input);
    }
    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    name: LocaleString;

    @Column() code: string;

    @OneToMany(type => ProductOptionTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<ProductOption>>;

    @Index()
    @ManyToOne(type => ProductOptionGroup, group => group.options)
    group: ProductOptionGroup;

    @EntityId()
    groupId: ID;

    // Declared explicitly: TypeORM 1.1.1+ defaults an undeclared inverse junction FK rule to CASCADE (#5594).
    @ManyToMany(type => ProductVariant, variant => variant.options, {
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
    })
    productVariants: ProductVariant[];

    @ManyToMany(type => Channel, channel => channel.productOptions)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];

    @Column(type => CustomProductOptionFields)
    customFields: CustomProductOptionFields;

    /**
     * @description
     * Returns the values of the ProductOption's `channelScoped` custom fields in the active Channel of
     * the RequestContext (or `options.channelId`), or `undefined` if the ProductOption is not assigned to
     * that Channel. They are not part of `customFields`, since they have a value per Channel.
     * Declare their types on {@link CustomProductOptionChannelFields}.
     *
     * Relation fields are only set if listed in `options.relations`. Calls made in the same tick
     * are batched into one query.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomProductOptionChannelFields>,
    ): Promise<CustomProductOptionChannelFields | undefined> {
        return readChannelCustomFields(ctx, ProductOption, this, options);
    }
}
