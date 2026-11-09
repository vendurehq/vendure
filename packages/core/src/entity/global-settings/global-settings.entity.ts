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
