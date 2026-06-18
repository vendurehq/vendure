import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomZoneFields } from '../custom-entity-fields';
import { Country } from '../region/country.entity';
import { Region } from '../region/region.entity';
import { TaxRate } from '../tax-rate/tax-rate.entity';

/**
 * @description
 * A Zone is a grouping of one or more {@link Country} entities. It is used for
 * calculating applicable shipping and taxes.
 *
 * @docsCategory entities
 */
@Entity()
export class Zone extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<Zone>) {
        super(input);
    }

    @Column() name: string;

    @ManyToMany(type => Region)
    @JoinTable()
    members: Region[];

    @Column(type => CustomZoneFields)
    customFields: CustomZoneFields;

    @OneToMany(type => Channel, country => country.defaultShippingZone)
    defaultShippingZoneChannels: Channel[];

    @OneToMany(type => Channel, country => country.defaultTaxZone)
    defaultTaxZoneChannels: Channel[];

    @OneToMany(type => TaxRate, taxRate => taxRate.zone)
    taxRates: TaxRate[];
}
