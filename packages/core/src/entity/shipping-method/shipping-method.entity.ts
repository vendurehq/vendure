import { ConfigurableOperation } from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { roundMoney } from '../../common/round-money';
import { ChannelAware, SoftDeletable } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { getConfig } from '../../config/config-helpers';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import {
    ShippingCalculationResult,
    ShippingCalculator,
} from '../../config/shipping-method/shipping-calculator';
import { ShippingEligibilityChecker } from '../../config/shipping-method/shipping-eligibility-checker';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomShippingMethodFields } from '../custom-entity-fields';
import { Order } from '../order/order.entity';

import { ShippingMethodTranslation } from './shipping-method-translation.entity';

/**
 * @description
 * A ShippingMethod is used to apply a shipping price to an {@link Order}. It is composed of a
 * {@link ShippingEligibilityChecker} and a {@link ShippingCalculator}. For a given Order,
 * the `checker` is used to determine whether this ShippingMethod can be used. If yes, then
 * the ShippingMethod can be applied and the `calculator` is used to determine the price of
 * shipping.
 *
 * @docsCategory entities
 */
@Entity()
export class ShippingMethod
    extends VendureEntity
    implements ChannelAware, SoftDeletable, HasCustomFields, Translatable
{
    private readonly allCheckers: { [code: string]: ShippingEligibilityChecker } = {};
    private readonly allCalculators: { [code: string]: ShippingCalculator } = {};

    constructor(input?: DeepPartial<ShippingMethod>) {
        super(input);
        const checkers = getConfig().shippingOptions.shippingEligibilityCheckers || [];
        const calculators = getConfig().shippingOptions.shippingCalculators || [];
        this.allCheckers = checkers.reduce((hash, o) => ({ ...hash, [o.code]: o }), {});
        this.allCalculators = calculators.reduce((hash, o) => ({ ...hash, [o.code]: o }), {});
    }

    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    @Column() code: string;

    name: LocaleString;

    description: LocaleString;

    @Column('simple-json') checker: ConfigurableOperation;

    @Column('simple-json') calculator: ConfigurableOperation;

    @Column()
    fulfillmentHandlerCode: string;

    @ManyToMany(type => Channel, channel => channel.shippingMethods)
    @JoinTable()
    channels: Channel[];

    @OneToMany(type => ShippingMethodTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<ShippingMethod>>;

    @Column(type => CustomShippingMethodFields)
    customFields: CustomShippingMethodFields;

    async apply(ctx: RequestContext, order: Order): Promise<ShippingCalculationResult | undefined> {
        const calculator = this.allCalculators[this.calculator.code];
        if (calculator) {
            const response = await calculator.calculate(ctx, order, this.calculator.args, this);
            if (response) {
                const { price, priceIncludesTax, taxRate, metadata } = response;
                return {
                    price: roundMoney(price),
                    priceIncludesTax,
                    taxRate,
                    metadata,
                };
            }
        }
    }

    async test(ctx: RequestContext, order: Order): Promise<boolean> {
        const checker = this.allCheckers[this.checker.code];
        if (checker) {
            return checker.check(ctx, order, this.checker.args, this);
        } else {
            return false;
        }
    }

    /**
     * This is a fix for https://github.com/vendurehq/vendure/issues/3277,
     * to prevent circular references which cause the JSON.stringify() to fail.
     */
    protected toJSON(): any {
        return omit(this, ['allCheckers', 'allCalculators'] as any);
    }
}
