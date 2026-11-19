import { Injectable } from '@nestjs/common';
import {
    ShippingMethodQuote,
    ShippingMethodSelectionInput,
    ShippingOptionQuote,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { RequestContext } from '../../../api/common/request-context';
import { grossPriceOf, netPriceOf } from '../../../common/tax-utils';
import { idsAreEqual } from '../../../common/utils';
import { ShippingCalculationResult } from '../../../config/shipping-method/shipping-calculator';
import { Order } from '../../../entity/order/order.entity';
import { ShippingLine } from '../../../entity/shipping-line/shipping-line.entity';
import { ShippingMethod } from '../../../entity/shipping-method/shipping-method.entity';
import { ShippingMethodService } from '../../services/shipping-method.service';

export type EligibleShippingMethod = {
    method: ShippingMethod;
    /**
     * The cheapest of `quotes`.
     */
    result: ShippingCalculationResult;
    /**
     * Every ShippingOption returned by the ShippingCalculator, cheapest first.
     */
    quotes: ShippingCalculationResult[];
};

/**
 * Picks the ShippingOption with the given code from the results of a ShippingCalculator.
 * With no code, the cheapest option is returned.
 */
export function findShippingOption(
    quotes: ShippingCalculationResult[],
    shippingOptionCode: string | null | undefined,
): ShippingCalculationResult | undefined {
    if (shippingOptionCode == null) {
        return quotes[0];
    }
    return quotes.find(quote => quote.code === shippingOptionCode);
}

/**
 * Normalizes the shipping method selections passed to `setShippingMethod`, which may be plain ids.
 */
export function toShippingMethodSelections(
    selections: Array<ID | ShippingMethodSelectionInput>,
): ShippingMethodSelectionInput[] {
    return selections.map(selection =>
        typeof selection === 'object' ? selection : { shippingMethodId: selection },
    );
}

/**
 * The ShippingLines which `OrderModifier.setShippingMethods()` has just set, in the order of the
 * selections, and whether any OrderLine was assigned to each.
 */
export type SelectedShippingLine = { id: ID; hasOrderLines: boolean };

/**
 * Whether each selection is still held by its own ShippingLine once the Order has been priced.
 * OrderCalculator falls back to another option or ShippingMethod when the selected option is not
 * offered, or when the ShippingCalculator returns nothing, which makes the selection a refused one.
 *
 * A ShippingLine to which no OrderLine was assigned is removed by OrderCalculator.applyShipping() and
 * is not a refusal: an empty Order can still have its ShippingMethod set.
 */
export function shippingSelectionsKept(
    selections: ShippingMethodSelectionInput[],
    selectedLines: SelectedShippingLine[],
    pricedShippingLines: ShippingLine[],
): boolean {
    return selections.every(({ shippingMethodId, shippingOptionCode }, i) => {
        const selected = selectedLines[i];
        if (!selected?.hasOrderLines) {
            return true;
        }
        const priced = pricedShippingLines.find(line => idsAreEqual(line.id, selected.id));
        return (
            !!priced &&
            idsAreEqual(priced.shippingMethodId, shippingMethodId) &&
            (shippingOptionCode == null || priced.shippingOptionCode === shippingOptionCode)
        );
    });
}

/**
 * Sets the ShippingMethod, the chosen ShippingOption and its price on a ShippingLine.
 */
export function setShippingLineOption(
    shippingLine: ShippingLine,
    shippingMethod: ShippingMethod,
    result: ShippingCalculationResult,
) {
    shippingLine.shippingMethod = shippingMethod;
    shippingLine.shippingMethodId = shippingMethod.id;
    shippingLine.shippingOptionCode = result.code ?? null;
    shippingLine.shippingOptionName = result.name ?? null;
    shippingLine.listPrice = result.price;
    // Calculators written in JavaScript may leave this out; the ShippingLine then keeps its value
    if (result.priceIncludesTax != null) {
        shippingLine.listPriceIncludesTax = result.priceIncludesTax;
    }
    shippingLine.taxLines = [{ description: 'shipping tax', taxRate: result.taxRate }];
}

/**
 * Converts an EligibleShippingMethod into the `ShippingMethodQuote` returned by the GraphQL APIs.
 */
export function toShippingMethodQuote(eligible: EligibleShippingMethod): ShippingMethodQuote {
    const { method } = eligible;
    const options = eligible.quotes.map(toShippingOptionQuote);
    // The top-level fields are those of the cheapest option
    const cheapest = options[0];
    return {
        id: method.id,
        name: method.name,
        code: method.code,
        description: method.description,
        price: cheapest.price,
        priceWithTax: cheapest.priceWithTax,
        metadata: cheapest.metadata,
        options,
    };
}

export function toShippingOptionQuote(result: ShippingCalculationResult): ShippingOptionQuote {
    const { price, taxRate, priceIncludesTax, metadata, code, name } = result;
    return {
        code,
        name,
        price: priceIncludesTax ? netPriceOf(price, taxRate) : price,
        priceWithTax: priceIncludesTax ? price : grossPriceOf(price, taxRate),
        metadata,
    };
}

@Injectable()
export class ShippingCalculator {
    constructor(private shippingMethodService: ShippingMethodService) {}

    /**
     * Returns an array of each eligible ShippingMethod for the given Order and sorts them by
     * the price of their cheapest ShippingOption, cheapest first.
     *
     * The `skipIds` argument is used to skip ShippingMethods with those IDs from being checked and calculated.
     */
    async getEligibleShippingMethods(
        ctx: RequestContext,
        order: Order,
        skipIds: ID[] = [],
    ): Promise<EligibleShippingMethod[]> {
        const shippingMethods = (await this.shippingMethodService.getActiveShippingMethods(ctx)).filter(
            method => !skipIds.includes(method.id),
        );

        const checkEligibilityPromises = shippingMethods.map(method =>
            this.checkEligibilityByShippingMethod(ctx, order, method),
        );
        const eligibleMethods = await Promise.all(checkEligibilityPromises);

        return eligibleMethods.filter(notNullOrUndefined).sort((a, b) => a.result.price - b.result.price);
    }

    async getMethodIfEligible(
        ctx: RequestContext,
        order: Order,
        shippingMethodId: ID,
    ): Promise<ShippingMethod | undefined> {
        const method = await this.shippingMethodService.findOne(ctx, shippingMethodId);
        if (method) {
            const eligible = await method.test(ctx, order);
            if (eligible) {
                return method;
            }
        }
    }

    private async checkEligibilityByShippingMethod(
        ctx: RequestContext,
        order: Order,
        method: ShippingMethod,
    ): Promise<EligibleShippingMethod | undefined> {
        const eligible = await method.test(ctx, order);
        if (eligible) {
            const quotes = await method.applyQuotes(ctx, order);
            if (quotes.length) {
                return { method, result: quotes[0], quotes };
            }
        }
    }
}
