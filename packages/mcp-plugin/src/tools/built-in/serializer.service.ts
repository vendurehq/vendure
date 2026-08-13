import { Injectable } from '@nestjs/common';
import { ShippingMethodQuote } from '@vendure/common/lib/generated-types';
import { ConfigService, CurrencyCode, ID, Order, Product, ProductVariant } from '@vendure/core';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isErrorResult(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && '__typename' in value && 'message' in value;
}

/**
 * Turns Vendure entities into the JSON that the built-in tools return.
 *
 * Every built-in tool that returns an entity goes through this one service, so each entity's
 * output shape has a single definition. Prices need the store's configured number of decimal
 * places, which is only reachable through `ConfigService`, which is why this is an injectable
 * service rather than a set of plain functions.
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

    product(product: (Product & { name?: string; slug?: string; description?: string }) | undefined | null) {
        if (!product) return null;
        return {
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            enabled: product.enabled,
            featuredAsset: product.featuredAsset ? this.asset(product.featuredAsset) : null,
        };
    }

    collection(
        collection:
            | { id: ID; name?: string; slug?: string; description?: string; featuredAsset?: unknown }
            | undefined
            | null,
    ) {
        if (!collection) return null;
        return {
            id: collection.id,
            name: collection.name,
            slug: collection.slug,
            description: collection.description,
            featuredAsset: collection.featuredAsset ? this.asset(collection.featuredAsset) : null,
        };
    }

    customer(
        customer:
            | { id?: ID; firstName?: string; lastName?: string; emailAddress?: string; phoneNumber?: string }
            | undefined
            | null,
    ) {
        if (!customer || !('id' in customer)) return null;
        return {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            emailAddress: customer.emailAddress,
            phoneNumber: customer.phoneNumber,
        };
    }

    /**
     * Vendure's customer mutations return either the Customer or one of its typed error results.
     * This exists because that union type cannot be passed to the `customer` method above
     * directly.
     *
     * An error result becomes null, so a tool using this reports a failure only as a null
     * customer, without the reason. That is the behaviour these tools already had. Note this is
     * deliberately not named like `orderOrError` below, which does the opposite and hands the
     * error result back to the caller intact.
     */
    customerFromResult(customer: unknown) {
        if (isErrorResult(customer)) {
            return null;
        }
        return this.customer(
            customer as
                | {
                      id?: ID;
                      firstName?: string;
                      lastName?: string;
                      emailAddress?: string;
                      phoneNumber?: string;
                  }
                | undefined
                | null,
        );
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

    /**
     * Vendure mutations return either the entity or one of its typed error results. An error result
     * is handed back untouched so the model sees Vendure's own message.
     */
    orderOrError(result: unknown) {
        if (isErrorResult(result)) {
            return { result };
        }
        return { order: this.order(result as Order | undefined) };
    }

    /**
     * A shipping quote arrives with raw whole-number prices and no currency code, because the
     * currency belongs to the order rather than to the quote. The caller passes it in.
     *
     * Unlike the methods above, this copies the quote and adds to it rather than listing the
     * fields it keeps. A shipping calculator can attach anything it likes under `metadata` or
     * `customFields`, and this tool has always returned those, so naming fields here would
     * silently drop them.
     */
    shippingQuote(quote: ShippingMethodQuote, currencyCode: CurrencyCode) {
        return {
            ...quote,
            priceDecimal: this.decimal(quote.price),
            priceWithTaxDecimal: this.decimal(quote.priceWithTax),
            currencyCode,
        };
    }

    /**
     * Private because no tool returns an asset on its own; assets only ever appear inside a
     * product or a collection.
     */
    private asset(asset: unknown) {
        if (!isRecord(asset)) return null;
        return {
            id: asset.id,
            name: asset.name,
            type: asset.type,
            mimeType: asset.mimeType,
            width: asset.width,
            height: asset.height,
            fileSize: asset.fileSize,
            source: asset.source,
            preview: asset.preview,
            focalPoint: asset.focalPoint,
            tags: Array.isArray(asset.tags)
                ? asset.tags.map(tag => (isRecord(tag) ? tag.value : tag))
                : undefined,
        };
    }
}
