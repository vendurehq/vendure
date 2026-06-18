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
     * @description
     * Specifies the default value for inventory tracking for ProductVariants.
     * Can be overridden per ProductVariant, but this value determines the default
     * if not otherwise specified.
     *
     * @deprecated use `Channel.trackInventory`
     */
    @Column({ default: true })
    trackInventory: boolean;

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
