import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

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
import { CustomFacetChannelFields, CustomFacetFields } from '../custom-entity-fields';
import { FacetValue } from '../facet-value/facet-value.entity';

import { FacetTranslation } from './facet-translation.entity';

/**
 * @description
 * A Facet is a class of properties which can be applied to a {@link Product} or {@link ProductVariant}.
 * They are used to enable [faceted search](https://en.wikipedia.org/wiki/Faceted_search) whereby products
 * can be filtered along a number of dimensions (facets).
 *
 * For example, there could be a Facet named "Brand" which has a number of {@link FacetValue}s representing
 * the various brands of product, e.g. "Apple", "Samsung", "Dell", "HP" etc.
 *
 * @docsCategory entities
 */
@Entity()
export class Facet extends VendureEntity implements Translatable, HasCustomFields, ChannelAware {
    constructor(input?: DeepPartial<Facet>) {
        super(input);
    }

    name: LocaleString;

    @Column({ default: false })
    isPrivate: boolean;

    @Column({ unique: true })
    code: string;

    @OneToMany(type => FacetTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<Facet>>;

    @OneToMany(type => FacetValue, value => value.facet)
    values: FacetValue[];

    @Column(type => CustomFacetFields)
    customFields: CustomFacetFields;

    /**
     * @description
     * Returns the values of the Facet's `channelScoped` custom fields in the active Channel of
     * the RequestContext (or `options.channelId`), or `undefined` if the Facet is not assigned to
     * that Channel. They are not part of `customFields`, since they have a value per Channel.
     * Declare their types on {@link CustomFacetChannelFields}.
     *
     * Relation fields are only set if listed in `options.relations`. Calls made in the same tick
     * are batched into one query.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomFacetChannelFields>,
    ): Promise<CustomFacetChannelFields | undefined> {
        return readChannelCustomFields(ctx, Facet, this, options);
    }

    @ManyToMany(type => Channel, channel => channel.facets)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];
}
