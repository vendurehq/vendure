import { Injectable } from '@nestjs/common';
import { OrderAddress, ShippingMethodQuote } from '@vendure/common/lib/generated-types';
import {
    Address,
    Asset,
    Channel,
    Collection,
    ConfigService,
    CurrencyCode,
    Customer,
    CustomerGroup,
    Fulfillment,
    FulfillmentLine,
    GraphQLErrorResult,
    ID,
    isGraphQlErrorResult,
    Order,
    Payment,
    Product,
    ProductOptionGroup,
    ProductVariant,
    Refund,
    StockLevel,
} from '@vendure/core';

/** How much of a product's description a list item keeps; `get_product` has the whole text. */
const LIST_ITEM_DESCRIPTION_LENGTH = 200;

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
    decimal(value: number | undefined | null): string {
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

    adminVariant(variant: ProductVariant, stockOnHand: number) {
        return { ...this.variant(variant), stockOnHand };
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

    productListItem(product: Product, variants: ProductVariant[]) {
        const description = product.description ?? '';
        return {
            id: product.id,
            name: product.name,
            slug: product.slug,
            description:
                description.length > LIST_ITEM_DESCRIPTION_LENGTH
                    ? `${description.slice(0, LIST_ITEM_DESCRIPTION_LENGTH)}...`
                    : description,
            enabled: product.enabled,
            featuredAsset: product.featuredAsset
                ? { id: product.featuredAsset.id, preview: product.featuredAsset.preview }
                : null,
            priceRange: this.priceRange(variants),
        };
    }

    private priceRange(variants: ProductVariant[]) {
        if (variants.length === 0) return null;
        const prices = variants.map(variant => variant.priceWithTax);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        return {
            min,
            minDecimal: this.decimal(min),
            max,
            maxDecimal: this.decimal(max),
            currencyCode: variants[0].currencyCode,
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

    customer(customer: Customer | undefined | null, addresses?: Address[]) {
        if (!customer) return null;
        return {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            emailAddress: customer.emailAddress,
            phoneNumber: customer.phoneNumber,
            addresses: addresses ? addresses.map(address => this.customerAddress(address)) : undefined,
        };
    }

    private customerAddress(address: Address) {
        return {
            id: address.id,
            ...this.address({
                fullName: address.fullName,
                company: address.company,
                streetLine1: address.streetLine1,
                streetLine2: address.streetLine2,
                city: address.city,
                province: address.province,
                postalCode: address.postalCode,
                // A saved address points at a Country entity, while an order stores the code directly.
                countryCode: address.country?.code,
                phoneNumber: address.phoneNumber,
            }),
            defaultShippingAddress: address.defaultShippingAddress,
            defaultBillingAddress: address.defaultBillingAddress,
        };
    }

    /** A customer group, whose ID is what `add_customer_to_group` takes. */
    customerGroup(group: CustomerGroup) {
        return { id: group.id, name: group.name };
    }

    /**
     * Vendure's customer mutations return either the Customer or one of its typed error results.
     * Errors are returned directly so the registry can report them as failed tool calls, following
     * the same convention as `orderOrError` below.
     */
    customerOrError(result: Customer | GraphQLErrorResult) {
        if (!isGraphQlErrorResult(result)) {
            return { customer: this.customer(result) };
        }
        return { ...result };
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
            refunds: payment.refunds?.map(refund => ({
                id: refund.id,
                state: refund.state,
                total: refund.total,
                totalDecimal: this.decimal(refund.total),
                reason: refund.reason ?? null,
            })),
        };
    }

    fulfillment(fulfillment: Fulfillment, lines: FulfillmentLine[]) {
        return {
            id: fulfillment.id,
            state: fulfillment.state,
            method: fulfillment.method,
            trackingCode: fulfillment.trackingCode,
            lines: lines.map(line => ({ orderLineId: line.orderLineId, quantity: line.quantity })),
        };
    }

    refund(refund: Refund, currencyCode: CurrencyCode) {
        return {
            id: refund.id,
            state: refund.state,
            total: refund.total,
            totalDecimal: this.decimal(refund.total),
            currencyCode,
            reason: refund.reason ?? null,
            paymentId: refund.paymentId,
        };
    }

    private orderAddress(address: OrderAddress | undefined | null) {
        if (!address || Object.keys(address).length === 0) return null;
        return this.address(address);
    }

    private address(address: {
        fullName?: string | null;
        company?: string | null;
        streetLine1?: string | null;
        streetLine2?: string | null;
        city?: string | null;
        province?: string | null;
        postalCode?: string | null;
        countryCode?: string | null;
        phoneNumber?: string | null;
    }) {
        // Only the fields that hold something are emitted: a key set to null tells the caller
        // nothing it cannot see from the key being absent, and costs it tokens. An empty string
        // stays, because that is a value someone typed into the field.
        const present: Record<string, string> = {};
        const fields = [
            'fullName',
            'company',
            'streetLine1',
            'streetLine2',
            'city',
            'province',
            'postalCode',
            'countryCode',
            'phoneNumber',
        ] as const;
        for (const field of fields) {
            const value = address[field];
            if (value != null) {
                present[field] = value;
            }
        }
        return present;
    }

    orderNote(entry: { id: ID; data: { note: string }; isPublic: boolean; createdAt: Date }) {
        return {
            id: entry.id,
            text: entry.data.note,
            isPublic: entry.isPublic,
            createdAt: this.isoDate(entry.createdAt),
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
            couponCodes: order.couponCodes,
            discounts: order.discounts.map(discount => ({
                adjustmentSource: discount.adjustmentSource,
                type: discount.type,
                description: discount.description,
                amount: discount.amount,
                amountDecimal: this.decimal(discount.amount),
                amountWithTax: discount.amountWithTax,
                amountWithTaxDecimal: this.decimal(discount.amountWithTax),
            })),
            lines:
                order.lines?.map(line => ({
                    id: line.id,
                    quantity: line.quantity,
                    linePriceWithTax: line.linePriceWithTax,
                    linePriceWithTaxDecimal: this.decimal(line.linePriceWithTax),
                    productVariant: line.productVariant
                        ? {
                              id: line.productVariant.id,
                              name: line.productVariant.name,
                              sku: line.productVariant.sku,
                          }
                        : null,
                })) ?? [],
            payments: order.payments ? order.payments.map(payment => this.payment(payment)) : undefined,
            // Undefined unless the tool loaded `fulfillments`, the same convention as `payments`.
            // The cart tools leave it out: an open cart has no shipments to report.
            fulfillments: order.fulfillments
                ? order.fulfillments.map(fulfillment =>
                      this.fulfillment(fulfillment, fulfillment.lines ?? []),
                  )
                : undefined,
            customer: this.orderCustomer(order.customer),
            shippingAddress: this.orderAddress(order.shippingAddress),
            billingAddress: this.orderAddress(order.billingAddress),
            shippingWithTax: order.shippingWithTax,
            shippingWithTaxDecimal: this.decimal(order.shippingWithTax),
            shippingLines: order.shippingLines
                ? order.shippingLines.map(line => ({
                      id: line.id,
                      shippingMethodId: line.shippingMethodId,
                      priceWithTax: line.priceWithTax,
                      priceWithTaxDecimal: this.decimal(line.priceWithTax),
                  }))
                : undefined,
        };
    }

    private orderCustomer(customer: Order['customer']) {
        if (customer === undefined) return undefined;
        if (customer === null) return null;
        return {
            id: customer.id,
            emailAddress: customer.emailAddress,
            firstName: customer.firstName,
            lastName: customer.lastName,
        };
    }

    /**
     * Vendure mutations return either an entity or a typed error. Errors are returned directly so
     * the registry can report them as failed tool calls. Errors containing orders or money values
     * are serialized consistently with successful results.
     */
    orderOrError(result: Order | GraphQLErrorResult) {
        if (!isGraphQlErrorResult(result)) {
            return { order: this.order(result) };
        }
        const errorResult: Record<string, unknown> = { ...result };
        if (errorResult.order instanceof Order) {
            errorResult.order = this.order(errorResult.order);
        }
        if (
            errorResult.errorCode === 'COUPON_REMOVED_DURING_CHECKOUT_ERROR' &&
            typeof errorResult.newTotalWithTax === 'number' &&
            typeof errorResult.previousTotalWithTax === 'number'
        ) {
            errorResult.newTotalWithTaxDecimal = this.decimal(errorResult.newTotalWithTax);
            errorResult.previousTotalWithTaxDecimal = this.decimal(errorResult.previousTotalWithTax);
        }
        return errorResult;
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
