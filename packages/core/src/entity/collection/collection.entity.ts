import { ConfigurableOperation } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import {
    Column,
    Entity,
    Index,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToMany,
    Tree,
    TreeChildren,
    TreeParent,
} from 'typeorm';

import type { RequestContext } from '../../api/common/request-context';
import { ChannelAware, Orderable } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { Asset } from '../asset/asset.entity';
import { VendureEntity } from '../base/base.entity';
import {
    ChannelCustomFieldsOptions,
    readChannelCustomFields,
} from '../channel-assignment/channel-custom-fields';
import { Channel } from '../channel/channel.entity';
import { CustomCollectionFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { ProductVariant } from '../product-variant/product-variant.entity';

import { CollectionAsset } from './collection-asset.entity';
import { CollectionTranslation } from './collection-translation.entity';

/**
 * @description
 * A Collection is a grouping of {@link Product}s based on various configurable criteria.
 *
 * @docsCategory entities
 */
@Entity()
@Tree('closure-table')
export class Collection
    extends VendureEntity
    implements Translatable, HasCustomFields, ChannelAware, Orderable
{
    constructor(input?: DeepPartial<Collection>) {
        super(input);
    }

    @Column({ default: false })
    isRoot: boolean;

    @Column()
    position: number;

    @Column({ default: false })
    isPrivate: boolean;

    name: LocaleString;

    description: LocaleString;

    slug: LocaleString;

    @OneToMany(type => CollectionTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<Collection>>;

    @Index()
    @ManyToOne(type => Asset, asset => asset.featuredInCollections, { onDelete: 'SET NULL' })
    featuredAsset: Asset;

    @OneToMany(type => CollectionAsset, collectionAsset => collectionAsset.collection)
    assets: CollectionAsset[];

    @Column('simple-json') filters: ConfigurableOperation[];

    /**
     * @since 2.0.0
     */
    @Column({ default: true }) inheritFilters: boolean;

    @ManyToMany(type => ProductVariant, productVariant => productVariant.collections)
    @JoinTable()
    productVariants: ProductVariant[];

    @Column(type => CustomCollectionFields)
    customFields: CustomCollectionFields;

    /**
     * @description
     * Returns the values of the Collection's channel-scoped custom fields in the active Channel of
     * the RequestContext (or `options.channelId`), or `undefined` if the Collection is not assigned to
     * that Channel.
     *
     * They are also set on `customFields` when the Collection is loaded with a RequestContext (e.g. by an
     * entity service). This method reads them for a Collection loaded without one, in another Channel, or
     * with relation fields.
     *
     * Relation fields are only set if listed in `options.relations`. Calls without relations made
     * in the same tick are batched into one query.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomCollectionFields>,
    ): Promise<Partial<CustomCollectionFields> | undefined> {
        return readChannelCustomFields(ctx, Collection, this, options);
    }

    @TreeChildren()
    children: Collection[];

    @TreeParent()
    parent: Collection;

    @EntityId({ nullable: true })
    parentId: ID;

    @ManyToMany(type => Channel, channel => channel.collections)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];
}
