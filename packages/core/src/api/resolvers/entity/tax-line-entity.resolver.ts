import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { hasTaxAmounts, StoredTaxLine } from '../../../common/tax-utils';

@Resolver('TaxLine')
export class TaxLineEntityResolver {
    /**
     * Only an amount that Vendure applies is exposed. An `amount` stored without the taxable total
     * that the OrderCalculator records with it, such as one from a custom strategy before v3.9, is
     * ignored by the price calculations, so it resolves to null.
     */
    @ResolveField()
    amount(@Parent() taxLine: StoredTaxLine): number | null {
        return hasTaxAmounts([taxLine]) ? (taxLine.amount ?? null) : null;
    }
}
