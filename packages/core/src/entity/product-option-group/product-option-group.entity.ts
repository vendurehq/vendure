import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

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
import {
    CustomProductOptionGroupChannelFields,
    CustomProductOptionGroupFields,
} from '../custom-entity-fields';
import { ProductOption } from '../product-option/product-option.entity';
import { Product } from '../product/product.entity';

import { ProductOptionGroupTranslation } from './product-option-group-translation.entity';

/**
 * @description
 * A grouping of one or more {@link ProductOption}s.
 *
 * @docsCategory entities
 */
@Entity()
export class ProductOptionGroup
    extends VendureEntity
    implements Translatable, HasCustomFields, SoftDeletable, ChannelAware
{
    constructor(input?: DeepPartial<ProductOptionGroup>) {
        super(input);
    }
    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    name: LocaleString;

    @Column()
    code: string;

    @OneToMany(type => ProductOptionGroupTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<ProductOptionGroup>>;

    @OneToMany(type => ProductOption, option => option.group)
    options: ProductOption[];

    // Declared explicitly: TypeORM 1.1.1+ defaults an undeclared inverse junction FK rule to CASCADE (#5594).
    @ManyToMany(type => Product, product => product.optionGroups, {
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
    })
    products: Product[];

    @ManyToMany(type => Channel, channel => channel.productOptionGroups)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];

    @Column(type => CustomProductOptionGroupFields)
    customFields: CustomProductOptionGroupFields;

    /**
     * @description
     * Returns the values of the ProductOptionGroup's `channelScoped` custom fields in the active Channel of
     * the RequestContext (or `options.channelId`), or `undefined` if the ProductOptionGroup is not assigned to
     * that Channel. They are not part of `customFields`, since they have a value per Channel.
     * Declare their types on {@link CustomProductOptionGroupChannelFields}.
     *
     * Relation fields are only set if listed in `options.relations`. Calls without relations made
     * in the same tick are batched into one query.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomProductOptionGroupChannelFields>,
    ): Promise<CustomProductOptionGroupChannelFields | undefined> {
        return readChannelCustomFields(ctx, ProductOptionGroup, this, options);
    }
}
