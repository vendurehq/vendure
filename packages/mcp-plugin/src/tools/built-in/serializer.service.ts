import { Injectable } from '@nestjs/common';
import { ShippingMethodQuote } from '@vendure/common/lib/generated-types';
import { ConfigService, CurrencyCode, Order, ProductVariant } from '@vendure/core';

import { isRecord } from './serializers';

/**
 * Turns Vendure order, variant and shipping-quote values into the JSON that built-in tools
 * return.
 *
 * These live in a service rather than beside the plain functions in `serializers.ts`
 * because they need the store's configured number of decimal places, which is only reachable
 * through `ConfigService`.
 */
@Injectable()
export class McpToolSerializerService {
    constructor(private configService: ConfigService) {}

    /**
     * Vendure keeps money as a whole number in the currency's smallest unit — 25199 means 251.99
     * in a store that keeps two decimal places. Tool results carry both that whole number, for
     * anything doing sums, and this string, so a language model can quote a price without having
     * to divide anything itself.
     *
     * The digits are shifted as text rather than divided, because dividing by 100 introduces
     * floating-point error on values a shop will really see.
     */
    private decimal(value: number | undefined | null): string {
        const precision = this.configService.entityOptions.moneyStrategy.precision ?? 2;
        // Every money value Vendure hands to this method is already a whole number under the
        // default configuration, so this rounding normally changes nothing. It only matters if a
        // store configures its own money strategy that can hand over a fractional amount instead.
        const rounded = Math.round(value ?? 0);
        const negative = rounded < 0;
        const digits = String(Math.abs(rounded));
        if (precision === 0) {
            return `${negative ? '-' : ''}${digits}`;
        }
        const padded = digits.padStart(precision + 1, '0');
        const whole = padded.slice(0, -precision);
        const fraction = padded.slice(-precision);
        return `${negative ? '-' : ''}${whole}.${fraction}`;
    }

    variant(variant: (ProductVariant & { name?: string }) | undefined | null) {
        if (!variant) return null;
        return {
            id: variant.id,
            name: variant.name,
            sku: variant.sku,
            enabled: variant.enabled,
            price: variant.price,
            priceDecimal: this.decimal(variant.price),
            priceWithTax: variant.priceWithTax,
            priceWithTaxDecimal: this.decimal(variant.priceWithTax),
            currencyCode: variant.currencyCode,
        };
    }

    order(order: Order | undefined | null) {
        if (!order) return null;
        return {
            id: order.id,
            code: order.code,
            state: order.state,
            active: order.active,
            total: order.total,
            totalDecimal: this.decimal(order.total),
            totalWithTax: order.totalWithTax,
            totalWithTaxDecimal: this.decimal(order.totalWithTax),
            currencyCode: order.currencyCode,
            totalQuantity: order.totalQuantity,
            lines:
                order.lines?.map(line => ({
                    id: line.id,
                    quantity: line.quantity,
                    linePriceWithTax: line.linePriceWithTax,
                    linePriceWithTaxDecimal: this.decimal(line.linePriceWithTax),
                    productVariant: line.productVariant ? this.variant(line.productVariant) : null,
                })) ?? [],
        };
    }

    shippingQuote(quote: ShippingMethodQuote, currencyCode: CurrencyCode) {
        return {
            ...quote,
            priceDecimal: this.decimal(quote.price),
            priceWithTaxDecimal: this.decimal(quote.priceWithTax),
            currencyCode,
        };
    }

    /**
     * Vendure mutations return either the entity or one of its typed error results. An error result
     * is handed back untouched so the model sees Vendure's own message.
     */
    orderOrError(result: unknown) {
        if (isRecord(result) && 'message' in result && '__typename' in result) {
            return { result };
        }
        return { order: this.order(result as Order | undefined) };
    }
}
