import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, OneToMany, OneToOne } from 'typeorm';

import type { RequestContext } from '../../api/common/request-context';
import { ChannelAware, SoftDeletable } from '../../common/types/common-types';
import { GLOBAL_IDENTITY_SCOPE } from '../../config/auth/identity-scope-strategy';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { Address } from '../address/address.entity';
import { VendureEntity } from '../base/base.entity';
import {
    ChannelCustomFieldsOptions,
    readChannelCustomFields,
} from '../channel-assignment/channel-custom-fields';
import { Channel } from '../channel/channel.entity';
import { CustomCustomerFields } from '../custom-entity-fields';
import { CustomerGroup } from '../customer-group/customer-group.entity';
import { Order } from '../order/order.entity';
import { User } from '../user/user.entity';

/**
 * @description
 * This entity represents a customer of the store, typically an individual person. A Customer can be
 * a guest, in which case it has no associated {@link User}. Customers with registered account will
 * have an associated User entity.
 *
 * @docsCategory entities
 */
@Entity()
@Index('IDX_CUSTOMER_IDENTITY_SCOPE_EMAIL', ['identityScope', 'emailAddress'])
export class Customer extends VendureEntity implements ChannelAware, HasCustomFields, SoftDeletable {
    constructor(input?: DeepPartial<Customer>) {
        super(input);
    }

    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    @Column({ nullable: true })
    title: string;

    @Column() firstName: string;

    @Column() lastName: string;

    @Column({ nullable: true })
    phoneNumber: string;

    @Column()
    emailAddress: string;

    /**
     * @description
     * The identity scope this Customer belongs to, as returned by the configured
     * {@link IdentityScopeStrategy} for the Channel it was created on. An email address
     * identifies at most one Customer within a scope. With the default
     * {@link GlobalIdentityScopeStrategy} every Customer is in the `global` scope.
     *
     * @since 4.0.0
     */
    @Column({ length: 255, default: GLOBAL_IDENTITY_SCOPE })
    identityScope: string;

    @ManyToMany(type => CustomerGroup, group => group.customers)
    @JoinTable()
    groups: CustomerGroup[];

    @OneToMany(type => Address, address => address.customer)
    addresses: Address[];

    @OneToMany(type => Order, order => order.customer)
    orders: Order[];

    @OneToOne(type => User, { eager: true })
    @JoinColumn()
    user?: User;

    @Column(type => CustomCustomerFields)
    customFields: CustomCustomerFields;

    /**
     * @description
     * Returns the values of the Customer's channel-scoped custom fields in a Channel, or `undefined` if
     * it is not assigned to that Channel. A Customer loaded with a RequestContext already has the
     * values of its Channel on `customFields`: see {@link ChannelAssignmentService.getChannelCustomFields}
     * for when to use this method, and its options.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomCustomerFields>,
    ): Promise<Partial<CustomCustomerFields> | undefined> {
        return readChannelCustomFields(ctx, Customer, this, options);
    }

    @ManyToMany(type => Channel, channel => channel.customers)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];
}
