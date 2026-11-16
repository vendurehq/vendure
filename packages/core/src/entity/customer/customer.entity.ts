import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinColumn, JoinTable, ManyToMany, OneToMany, OneToOne } from 'typeorm';

import type { RequestContext } from '../../api/common/request-context';
import { ChannelAware, SoftDeletable } from '../../common/types/common-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { Address } from '../address/address.entity';
import { VendureEntity } from '../base/base.entity';
import {
    ChannelCustomFieldsOptions,
    readChannelCustomFields,
} from '../channel-assignment/channel-custom-fields';
import { Channel } from '../channel/channel.entity';
import { CustomCustomerChannelFields, CustomCustomerFields } from '../custom-entity-fields';
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
     * Returns the values of the Customer's `channelScoped` custom fields in the active Channel of
     * the RequestContext (or `options.channelId`), or `undefined` if the Customer is not assigned to
     * that Channel. They are not part of `customFields`, since they have a value per Channel.
     * Declare their types on {@link CustomCustomerChannelFields}.
     *
     * Relation fields are only set if listed in `options.relations`. Calls without relations made
     * in the same tick are batched into one query.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomCustomerChannelFields>,
    ): Promise<CustomCustomerChannelFields | undefined> {
        return readChannelCustomFields(ctx, Customer, this, options);
    }

    @ManyToMany(type => Channel, channel => channel.customers)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];
}
