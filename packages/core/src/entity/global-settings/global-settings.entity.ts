import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity } from 'typeorm';

import { VendureEntity } from '..';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { CustomGlobalSettingsFields } from '../custom-entity-fields';

/**
 * @description Stores global settings for the whole application
 *
 * @docsCategory entities
 */
@Entity()
export class GlobalSettings extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<GlobalSettings>) {
        super(input);
    }

    /**
     * @deprecated use `Channel.availableLanguageCodes`
     */
    @Column('simple-array')
    availableLanguages: LanguageCode[];

    /**
     * The pre-v4 `GlobalSettings.trackInventory` value, kept in its original column until it has
     * been copied to every Channel on upgrade, then set to `null`. It is not exposed in the API
     * and nothing else reads it: from v4.0, `Channel.trackInventory` is the default. Keeping the
     * column on the entity stops `synchronize` and generated migrations from dropping it before
     * the value has been copied. See `migrateTrackInventoryToChannels()`.
     *
     * @internal
     */
    @Column({ name: 'trackInventory', type: Boolean, nullable: true, default: null, select: false })
    legacyTrackInventory: boolean | null;

    /**
     * @description
     * Specifies the value of stockOnHand at which a given ProductVariant is considered
     * out of stock.
     *
     * @deprecated use `Channel.outOfStockThreshold`
     */
    @Column({ default: 0 })
    outOfStockThreshold: number;

    @Column(type => CustomGlobalSettingsFields)
    customFields: CustomGlobalSettingsFields;
}
