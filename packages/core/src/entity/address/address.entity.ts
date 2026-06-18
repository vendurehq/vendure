import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomAddressFields } from '../custom-entity-fields';
import { Customer } from '../customer/customer.entity';
import { Country } from '../region/country.entity';

/**
 * @description
 * Represents a {@link Customer}'s address.
 *
 * @docsCategory entities
 */
@Entity()
export class Address extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<Address>) {
        super(input);
    }

    @Index()
    @ManyToOne(type => Customer, customer => customer.addresses)
    customer: Customer;

    @Column({ default: '' }) fullName: string;

    @Column({ default: '' })
    company: string;

    @Column() streetLine1: string;

    @Column({ default: '' })
    streetLine2: string;

    @Column({ default: '' }) city: string;

    @Column({ default: '' })
    province: string;

    @Column({ default: '' }) postalCode: string;

    @Index()
    @ManyToOne(type => Country)
    country: Country;

    @Column({ default: '' })
    phoneNumber: string;

    @Column({ default: false })
    defaultShippingAddress: boolean;

    @Column({ default: false })
    defaultBillingAddress: boolean;

    @Column(type => CustomAddressFields)
    customFields: CustomAddressFields;
}
