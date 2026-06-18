import { TaxLine } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';

/**
 * @description
 * This strategy defines how the TaxLines on OrderItems are calculated. By default,
 * the {@link DefaultTaxLineCalculationStrategy} is used, which directly applies
 * a single TaxLine based on the applicable {@link TaxRate}.
 *
 * However, custom strategies may use any suitable method for calculating TaxLines.
 * For example, a third-party tax API or a lookup of a custom tax table may be used.
 *
 * :::info
 *
 * This is configured via the `taxOptions.taxLineCalculationStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory tax
 * @docsPage TaxLineCalculationStrategy
 * @docsWeight 0
 */
export interface TaxLineCalculationStrategy extends InjectableStrategy {
    /**
     * @description
     * This method is called when calculating the Order prices. Since it will be called
     * whenever an Order is modified in some way (adding/removing items, applying promotions,
     * setting ShippingMethod etc), care should be taken so that calling the function does
     * not adversely impact overall performance. For example, by using caching and only
     * calling external APIs when absolutely necessary.
     */
    calculate(args: CalculateTaxLinesArgs): TaxLine[] | Promise<TaxLine[]>;
}

/**
 * @description
 *
 * @docsCategory tax
 * @docsPage TaxLineCalculationStrategy
 */
export interface CalculateTaxLinesArgs {
    ctx: RequestContext;
    order: Order;
    orderLine: OrderLine;
    applicableTaxRate: TaxRate;
}
