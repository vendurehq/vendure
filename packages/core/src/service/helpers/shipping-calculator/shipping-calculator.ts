import { Injectable } from '@nestjs/common';
import { ShippingMethodQuote, ShippingOptionQuote } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { RequestContext } from '../../../api/common/request-context';
import { grossPriceOf, netPriceOf } from '../../../common/tax-utils';
import { ShippingCalculationResult } from '../../../config/shipping-method/shipping-calculator';
import { Order } from '../../../entity/order/order.entity';
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
 * Converts an EligibleShippingMethod into the `ShippingMethodQuote` returned by the GraphQL APIs.
 */
export function toShippingMethodQuote(eligible: EligibleShippingMethod): ShippingMethodQuote {
    const { method, result } = eligible;
    const options = eligible.quotes.map(toShippingOptionQuote);
    return {
        id: method.id,
        name: method.name,
        code: method.code,
        description: method.description,
        price: options[0].price,
        priceWithTax: options[0].priceWithTax,
        metadata: result.metadata,
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

    /**
     * Returns the ShippingMethod and the result of the ShippingOption with the given code, if the
     * ShippingMethod is eligible for the Order and its ShippingCalculator currently offers that option.
     *
     * @since 4.0.0
     */
    async getOptionIfEligible(
        ctx: RequestContext,
        order: Order,
        shippingMethodId: ID,
        shippingOptionCode: string,
    ): Promise<{ method: ShippingMethod; result: ShippingCalculationResult } | undefined> {
        const method = await this.getMethodIfEligible(ctx, order, shippingMethodId);
        if (method) {
            const result = findShippingOption(await method.applyQuotes(ctx, order), shippingOptionCode);
            if (result) {
                return { method, result };
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
