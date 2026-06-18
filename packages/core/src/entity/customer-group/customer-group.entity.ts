import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, ManyToMany, OneToMany } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomCustomerGroupFields } from '../custom-entity-fields';
import { Customer } from '../customer/customer.entity';
import { TaxRate } from '../tax-rate/tax-rate.entity';

/**
 * @description
 * A grouping of {@link Customer}s which enables features such as group-based promotions
 * or tax rules.
 *
 * @docsCategory entities
 */
@Entity()
export class CustomerGroup extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<CustomerGroup>) {
        super(input);
    }

    @Column() name: string;

    @ManyToMany(type => Customer, customer => customer.groups)
    customers: Customer[];

    @Column(type => CustomCustomerGroupFields)
    customFields: CustomCustomerGroupFields;

    @OneToMany(type => TaxRate, taxRate => taxRate.zone)
    taxRates: TaxRate[];
}
