import { AssetType } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

import type { RequestContext } from '../../api/common/request-context';
import { ChannelAware, Taggable } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import {
    ChannelCustomFieldsOptions,
    readChannelCustomFields,
} from '../channel-assignment/channel-custom-fields';
import { Channel } from '../channel/channel.entity';
import { Collection } from '../collection/collection.entity';
import { CustomAssetFields } from '../custom-entity-fields';
import { ProductVariant } from '../product-variant/product-variant.entity';
import { Product } from '../product/product.entity';
import { Tag } from '../tag/tag.entity';

import { AssetTranslation } from './asset-translation.entity';
import { AssetUsage } from './asset-usage';

/**
 * @description
 * An Asset represents a file such as an image which can be associated with certain other entities
 * such as Products.
 *
 * @docsCategory entities
 */
@Entity()
export class Asset extends VendureEntity implements Taggable, ChannelAware, HasCustomFields, Translatable {
    constructor(input?: DeepPartial<Asset>) {
        super(input);
    }

    name: LocaleString;

    @Column('varchar') type: AssetType;

    /**
     * Describes whether this is a library Asset or an Asset used by an internal system feature.
     * System Assets are managed through the operation which owns them and excluded from ordinary
     * Asset queries. This does not control access to the underlying storage URL.
     *
     * @internal
     */
    @Column('varchar', { default: AssetUsage.LIBRARY })
    usage: AssetUsage;

    @Column() mimeType: string;

    @Column({ default: 0 }) width: number;

    @Column({ default: 0 }) height: number;

    @Column() fileSize: number;

    @Column() source: string;

    @Column() preview: string;

    @Column('simple-json', { nullable: true })
    focalPoint?: { x: number; y: number };

    @ManyToMany(type => Tag)
    @JoinTable()
    tags: Tag[];

    @ManyToMany(type => Channel)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];

    @OneToMany(type => Collection, collection => collection.featuredAsset)
    featuredInCollections?: Collection[];

    @OneToMany(type => ProductVariant, productVariant => productVariant.featuredAsset)
    featuredInVariants?: ProductVariant[];

    @OneToMany(type => Product, product => product.featuredAsset)
    featuredInProducts?: Product[];

    @Column(type => CustomAssetFields)
    customFields: CustomAssetFields;

    /**
     * @description
     * Returns the values of the Asset's channel-scoped custom fields in a Channel, or `undefined` if
     * it is not assigned to that Channel. An Asset loaded with a RequestContext already has the
     * values of its Channel on `customFields`: see {@link ChannelAssignmentService.getChannelCustomFields}
     * for when to use this method, and its options.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomAssetFields>,
    ): Promise<Partial<CustomAssetFields> | undefined> {
        return readChannelCustomFields(ctx, Asset, this, options);
    }

    @OneToMany(type => AssetTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<Asset>>;
}
