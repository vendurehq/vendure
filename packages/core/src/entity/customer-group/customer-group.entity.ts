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

    // Declared explicitly: TypeORM 1.1.1+ defaults an undeclared inverse junction FK rule to CASCADE (#5594).
    @ManyToMany(type => Customer, customer => customer.groups, {
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
    })
    customers: Customer[];

    @Column(type => CustomCustomerGroupFields)
    customFields: CustomCustomerGroupFields;

    @OneToMany(type => TaxRate, taxRate => taxRate.customerGroup)
    taxRates: TaxRate[];
}
