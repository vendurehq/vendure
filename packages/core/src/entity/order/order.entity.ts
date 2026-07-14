import {
    CurrencyCode,
    Discount,
    OrderAddress,
    OrderTaxSummary,
    OrderType,
} from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';

import { Calculated } from '../../common/calculated-decorator';
import { InternalServerError } from '../../common/error/errors';
import { ChannelAware } from '../../common/types/common-types';
import { getConfig } from '../../config/config-helpers';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { OrderState } from '../../service/helpers/order-state-machine/order-state';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomOrderFields } from '../custom-entity-fields';
import { Customer } from '../customer/customer.entity';
import { EntityId } from '../entity-id.decorator';
import { Fulfillment } from '../fulfillment/fulfillment.entity';
import { Money } from '../money.decorator';
import { OrderLine } from '../order-line/order-line.entity';
import { OrderModification } from '../order-modification/order-modification.entity';
import { Payment } from '../payment/payment.entity';
import { Promotion } from '../promotion/promotion.entity';
import { ShippingLine } from '../shipping-line/shipping-line.entity';
import { Surcharge } from '../surcharge/surcharge.entity';

/**
 * @description
 * An Order is created whenever a {@link Customer} adds an item to the cart. It contains all the
 * information required to fulfill an order: which {@link ProductVariant}s in what quantities;
 * the shipping address and price; any applicable promotions; payments etc.
 *
 * An Order exists in a well-defined state according to the {@link OrderState} type. A state machine
 * is used to govern the transition from one state to another.
 *
 * @docsCategory entities
 */
@Entity()
export class Order extends VendureEntity implements ChannelAware, HasCustomFields {
    constructor(input?: DeepPartial<Order>) {
        super(input);
    }

    @Column('varchar', { default: OrderType.Regular })
    type: OrderType;

    @OneToMany(type => Order, sellerOrder => sellerOrder.aggregateOrder)
    sellerOrders: Order[];

    @Index()
    @ManyToOne(type => Order, aggregateOrder => aggregateOrder.sellerOrders)
    aggregateOrder?: Order;

    @EntityId({ nullable: true })
    aggregateOrderId?: ID;

    /**
     * @description
     * A unique code for the Order, generated according to the
     * {@link OrderCodeStrategy}. This should be used as an order reference
     * for Customers, rather than the Order's id.
     */
    @Column()
    @Index({ unique: true })
    code: string;

    @Column('varchar') state: OrderState;

    /**
     * @description
     * Whether the Order is considered "active", meaning that the
     * Customer can still make changes to it and has not yet completed
     * the checkout process.
     * This is governed by the {@link OrderPlacedStrategy}.
     */
    @Column({ default: true })
    active: boolean;

    /**
     * @description
     * The date & time that the Order was placed, i.e. the Customer
     * completed the checkout and the Order is no longer "active".
     * This is governed by the {@link OrderPlacedStrategy}.
     */
    @Column({ nullable: true })
    @Index()
    orderPlacedAt?: Date;

    @Index()
    @ManyToOne(type => Customer, customer => customer.orders)
    customer?: Customer;

    @EntityId({ nullable: true })
    customerId?: ID;

    @OneToMany(type => OrderLine, line => line.order)
    lines: OrderLine[];

    /**
     * @description
     * Surcharges are arbitrary modifications to the Order total which are neither
     * ProductVariants nor discounts resulting from applied Promotions. For example,
     * one-off discounts based on customer interaction, or surcharges based on payment
     * methods.
     */
    @OneToMany(type => Surcharge, surcharge => surcharge.order)
    surcharges: Surcharge[];

    /**
     * @description
     * An array of all coupon codes applied to the Order.
     */
    @Column('simple-array')
    couponCodes: string[];

    /**
     * @description
     * Promotions applied to the order. Only gets populated after the payment process has completed,
     * i.e. the Order is no longer active.
     */
    @ManyToMany(type => Promotion, promotion => promotion.orders)
    @JoinTable()
    promotions: Promotion[];

    @Column('simple-json') shippingAddress: OrderAddress;

    @Column('simple-json') billingAddress: OrderAddress;

    @OneToMany(type => Payment, payment => payment.order)
    payments: Payment[];

    @ManyToMany(type => Fulfillment, fulfillment => fulfillment.orders)
    @JoinTable()
    fulfillments: Fulfillment[];

    @Column('varchar')
    currencyCode: CurrencyCode;

    @Column(type => CustomOrderFields)
    customFields: CustomOrderFields;

    @EntityId({ nullable: true })
    taxZoneId?: ID;

    @ManyToMany(type => Channel)
    @JoinTable()
    channels: Channel[];

    @OneToMany(type => OrderModification, modification => modification.order)
    modifications: OrderModification[];

    /**
     * @description
     * The subTotal is the total of all OrderLines in the Order. This figure also includes any Order-level
     * discounts which have been prorated (proportionally distributed) amongst the OrderItems.
     * To get a total of all OrderLines which does not account for prorated discounts, use the
     * sum of {@link OrderLine}'s `discountedLinePrice` values.
     */
    @Money()
    subTotal: number;

    /**
     * @description
     * Same as subTotal, but inclusive of tax.
     */
    @Money()
    subTotalWithTax: number;

    /**
     * @description
     * The shipping charges applied to this order.
     */
    @OneToMany(type => ShippingLine, shippingLine => shippingLine.order)
    shippingLines: ShippingLine[];

    /**
     * @description
     * The total of all the `shippingLines`.
     */
    @Money({ default: 0 })
    shipping: number;

    @Money({ default: 0 })
    shippingWithTax: number;

    @Calculated({ relations: ['lines', 'shippingLines'] })
    get discounts(): Discount[] {
        this.throwIfLinesNotJoined('discounts');
        const groupedAdjustments = new Map<string, Discount>();
        for (const line of this.lines ?? []) {
            for (const discount of line.discounts) {
                const adjustment = groupedAdjustments.get(discount.adjustmentSource);
                if (adjustment) {
                    adjustment.amount += discount.amount;
                    adjustment.amountWithTax += discount.amountWithTax;
                } else {
                    groupedAdjustments.set(discount.adjustmentSource, { ...discount });
                }
            }
        }
        for (const shippingLine of this.shippingLines ?? []) {
            for (const discount of shippingLine.discounts) {
                const adjustment = groupedAdjustments.get(discount.adjustmentSource);
                if (adjustment) {
                    adjustment.amount += discount.amount;
                    adjustment.amountWithTax += discount.amountWithTax;
                } else {
                    groupedAdjustments.set(discount.adjustmentSource, { ...discount });
                }
            }
        }
        return [...groupedAdjustments.values()];
    }

    /**
     * @description
     * Equal to `subTotal` plus `shipping`
     */
    @Calculated({
        query: qb =>
            qb
                .leftJoin(
                    qb1 => {
                        return qb1
                            .from(Order, 'order')
                            .select('order.shipping + order.subTotal', 'total')
                            .addSelect('order.id', 'oid');
                    },
                    't1',
                    't1.oid = order.id',
                )
                .addSelect('t1.total', 'total'),
        expression: 'total',
    })
    get total(): number {
        return this.subTotal + (this.shipping || 0);
    }

    /**
     * @description
     * The final payable amount. Equal to `subTotalWithTax` plus `shippingWithTax`.
     */
    @Calculated({
        query: qb =>
            qb
                .leftJoin(
                    qb1 => {
                        return qb1
                            .from(Order, 'order')
                            .select('order.shippingWithTax + order.subTotalWithTax', 'twt')
                            .addSelect('order.id', 'oid');
                    },
                    't1',
                    't1.oid = order.id',
                )
                .addSelect('t1.twt', 'twt'),
        expression: 'twt',
    })
    get totalWithTax(): number {
        return this.subTotalWithTax + (this.shippingWithTax || 0);
    }

    @Calculated({
        relations: ['lines'],
        query: qb => {
            qb.leftJoin(
                qb1 => {
                    return qb1
                        .from(Order, 'order')
                        .select('SUM(lines.quantity)', 'qty')
                        .addSelect('order.id', 'oid')
                        .leftJoin('order.lines', 'lines')
                        .groupBy('order.id');
                },
                't1',
                't1.oid = order.id',
            ).addSelect('t1.qty', 'qty');
        },
        expression: 'qty',
    })
    get totalQuantity(): number {
        this.throwIfLinesNotJoined('totalQuantity');
        return summate(this.lines, 'quantity');
    }

    /**
     * @description
     * A summary of the taxes being applied to this Order.
     */
    @Calculated({ relations: ['lines', 'surcharges', 'shippingLines'] })
    get taxSummary(): OrderTaxSummary[] {
        this.throwIfLinesNotJoined('taxSummary');
        this.throwIfSurchargesNotJoined('taxSummary');
        const { orderTaxCalculationStrategy } = getConfig().taxOptions;
        return orderTaxCalculationStrategy.calculateTaxSummary(this);
    }

    private throwIfLinesNotJoined(propertyName: keyof Order) {
        if (this.lines == null) {
            const errorMessage = [
                `The property "${propertyName}" on the Order entity requires the Order.lines relation to be joined.`,
                "This can be done with the EntityHydratorService: `await entityHydratorService.hydrate(ctx, order, { relations: ['lines'] })`",
            ];

            throw new InternalServerError(errorMessage.join('\n'));
        }
    }
    private throwIfSurchargesNotJoined(propertyName: keyof Order) {
        if (this.surcharges == null) {
            const errorMessage = [
                `The property "${propertyName}" on the Order entity requires the Order.surcharges relation to be joined.`,
                "This can be done with the EntityHydratorService: `await entityHydratorService.hydrate(ctx, order, { relations: ['surcharges'] })`",
            ];

            throw new InternalServerError(errorMessage.join('\n'));
        }
    }
}
