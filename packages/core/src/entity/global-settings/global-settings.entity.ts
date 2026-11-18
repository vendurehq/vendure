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
     * @description
     * The languages which are available in this Vendure instance. A Channel's
     * `defaultLanguageCode` must be one of them. Each Channel selects the languages it offers in
     * `Channel.availableLanguageCodes`.
     */
    @Column('simple-array')
    availableLanguages: LanguageCode[];

    /**
     * The pre-v4 `GlobalSettings.trackInventory` value, kept in its original column until
     * `migrateTrackInventoryToChannels()` has copied it to every Channel and set it to `null`. It is
     * not exposed in the API and nothing else reads it: from v4.0, `Channel.trackInventory` is the
     * default. Keeping the column on the entity stops `synchronize` and generated migrations from
     * dropping the value before it has been copied.
     *
     * @internal
     */
    @Column({ name: 'trackInventory', type: Boolean, nullable: true, default: null, select: false })
    legacyTrackInventory: boolean | null;

    /**
     * The pre-v4 `GlobalSettings.outOfStockThreshold` value, kept in its original column until
     * `migrateOutOfStockThresholdToChannels()` has copied it to every Channel and set it to `null`.
     * It is not exposed in the API and nothing else reads it: from v4.0, `Channel.outOfStockThreshold`
     * is used by every ProductVariant with `useGlobalOutOfStockThreshold`. Keeping the column on the
     * entity stops `synchronize` and generated migrations from dropping the value before it has
     * been copied.
     *
     * @internal
     */
    @Column({ name: 'outOfStockThreshold', type: Number, nullable: true, default: null, select: false })
    legacyOutOfStockThreshold: number | null;

    @Column(type => CustomGlobalSettingsFields)
    customFields: CustomGlobalSettingsFields;
}
