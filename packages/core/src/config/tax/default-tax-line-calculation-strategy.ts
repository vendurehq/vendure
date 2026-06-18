import { TaxLine } from '@vendure/common/lib/generated-types';

import { CalculateTaxLinesArgs, TaxLineCalculationStrategy } from './tax-line-calculation-strategy';

/**
 * @description
 * The default {@link TaxLineCalculationStrategy} which applies a single TaxLine to the OrderLine
 * based on the applicable {@link TaxRate}.
 *
 * @docsCategory tax
 */
export class DefaultTaxLineCalculationStrategy implements TaxLineCalculationStrategy {
    calculate(args: CalculateTaxLinesArgs): TaxLine[] {
        const { orderLine, applicableTaxRate } = args;
        return [applicableTaxRate.apply(orderLine.proratedUnitPrice)];
    }
}
