import { Injectable } from '@nestjs/common';
import { ShippingMethodQuote } from '@vendure/common/lib/generated-types';
import {
    Asset,
    Channel,
    Collection,
    ConfigService,
    CurrencyCode,
    Customer,
    CustomerGroup,
    GraphQLErrorResult,
    isGraphQlErrorResult,
    Order,
    Payment,
    Product,
    ProductOptionGroup,
    ProductVariant,
    StockLevel,
} from '@vendure/core';

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

    /**
     * Dates go out as ISO 8601 strings in UTC, which is the one format a language model can
     * compare and quote without knowing anything about the server's timezone.
     */
    private isoDate(value: Date | undefined | null): string | null {
        return value ? new Date(value).toISOString() : null;
    }

    variant(variant: ProductVariant | undefined | null) {
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

    product(product: Product | undefined | null) {
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

    /**
     * A product's option group with its options, for example "size" with small, medium and large.
     * The option IDs are what `create_variant` and `update_variant` take, so an agent can build a
     * variant without going to the dashboard for them.
     */
    optionGroup(group: ProductOptionGroup) {
        return {
            id: group.id,
            code: group.code,
            name: group.name,
            options: (group.options ?? []).map(option => ({
                id: option.id,
                code: option.code,
                name: option.name,
            })),
        };
    }

    /**
     * One stock location's figures for a variant. `stockLocationId` is what `adjust_stock` needs;
     * the location name is there so an agent can tell locations apart without another lookup.
     */
    stockLevel(level: StockLevel) {
        return {
            stockLocationId: level.stockLocationId,
            stockLocationName: level.stockLocation?.name ?? null,
            stockOnHand: level.stockOnHand,
            stockAllocated: level.stockAllocated,
        };
    }

    collection(collection: Collection | undefined | null) {
        if (!collection) return null;
        return {
            id: collection.id,
            name: collection.name,
            slug: collection.slug,
            description: collection.description,
            featuredAsset: collection.featuredAsset ? this.asset(collection.featuredAsset) : null,
        };
    }

    channel(channel: Channel) {
        return {
            id: channel.id,
            code: channel.code,
            token: channel.token,
        };
    }

    customer(customer: Customer | undefined | null) {
        if (!customer) return null;
        return {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            emailAddress: customer.emailAddress,
            phoneNumber: customer.phoneNumber,
        };
    }

    /** A customer group, whose ID is what `add_customer_to_group` takes. */
    customerGroup(group: CustomerGroup) {
        return { id: group.id, name: group.name };
    }

    /**
     * Vendure's customer mutations return either the Customer or one of its typed error results.
     * This method tells the two apart.
     *
     * An error result becomes null, so a tool using this reports a failure only as a null
     * customer, without the reason. That is the behaviour these tools already had. Note this is
     * deliberately not named like `orderOrError` below, which does the opposite and hands the
     * error result back to the caller intact.
     */
    customerFromResult(result: Customer | GraphQLErrorResult) {
        return isGraphQlErrorResult(result) ? null : this.customer(result);
    }

    /**
     * A payment taken against an order. The state and the amount tell a caller whether this payment
     * finished the checkout, or left part of the total unpaid.
     */
    payment(payment: Payment) {
        return {
            id: payment.id,
            method: payment.method,
            amount: payment.amount,
            amountDecimal: this.decimal(payment.amount),
            state: payment.state,
            transactionId: payment.transactionId,
            errorMessage: payment.errorMessage,
            publicMetadata: payment.metadata?.public ?? null,
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
            createdAt: this.isoDate(order.createdAt),
            updatedAt: this.isoDate(order.updatedAt),
            // Null while the order is still an open cart, set when the customer checks out.
            orderPlacedAt: this.isoDate(order.orderPlacedAt),
            lines:
                order.lines?.map(line => ({
                    id: line.id,
                    quantity: line.quantity,
                    linePriceWithTax: line.linePriceWithTax,
                    linePriceWithTaxDecimal: this.decimal(line.linePriceWithTax),
                    productVariant: line.productVariant ? this.variant(line.productVariant) : null,
                })) ?? [],
            payments: order.payments ? order.payments.map(payment => this.payment(payment)) : undefined,
        };
    }

    /**
     * Vendure mutations return either the entity or one of its typed error results. An error result
     * is handed back untouched and bare: the registry recognises a Vendure error result at the top
     * level of a tool's output and reports the call as failed, with the error's `errorCode` and
     * `message` as the structured content.
     */
    orderOrError(result: Order | GraphQLErrorResult) {
        if (isGraphQlErrorResult(result)) {
            return result;
        }
        return { order: this.order(result) };
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
     * Called directly by `upload_asset`, and from `product()` and `collection()` for the asset
     * fields they carry.
     */
    asset(asset: Asset) {
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
            // Undefined unless the caller loaded the asset's `tags` relation, which no built-in
            // tool currently does.
            tags: asset.tags?.map(tag => tag.value),
        };
    }
}
