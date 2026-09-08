import { Injectable } from '@nestjs/common';
import { OrderAddress, PaymentMethodQuote, ShippingMethodQuote } from '@vendure/common/lib/generated-types';
import {
    Address,
    Asset,
    Channel,
    Collection,
    ConfigService,
    CurrencyCode,
    Customer,
    CustomerGroup,
    CustomFields,
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

// Every built-in tool that returns an entity goes through this service, so each entity's output
// shape has a single definition. It needs to be injectable because prices need the store's
// configured decimal places, which only ConfigService can provide.
@Injectable()
export class McpToolSerializerService {
    constructor(private readonly configService: ConfigService) {}

    // Tool results carry the raw whole-number amount as well as this formatted string, so a
    // language model can quote a price without doing the division itself.
    //
    // The digits are shifted as text rather than divided, because dividing by 100 can introduce
    // floating-point error on real-world prices.
    decimal(value: number | undefined | null): string {
        const precision = this.configService.entityOptions.moneyStrategy.precision ?? 2;
        // Only matters if a store configures its own money strategy that can hand over a
        // fractional amount; under the default one this is already a whole number.
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

    // UTC ISO strings so a language model can compare and quote dates without knowing the server's timezone.
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

    // The option IDs here are what create_variant and update_variant take.
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

    // stockLocationId is what adjust_stock needs; the name lets an agent tell locations apart.
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

    // Errors are returned directly so the registry can report them as failed tool calls.
    customerOrError(result: Customer | GraphQLErrorResult) {
        if (!isGraphQlErrorResult(result)) {
            return { customer: this.customer(result) };
        }
        return { ...result };
    }

    // State and amount together tell a caller whether this payment finished the checkout or left a balance.
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
        // Null fields are dropped rather than sent as null, to save tokens; an empty string is kept
        // since that's a value someone actually typed in.
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
            // Left out by the cart tools, since an open cart has no shipments to report.
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

    // Errors are returned directly so the registry can report them as failed tool calls.
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

    // The currency belongs to the order, not the quote, so the caller passes it in.
    shippingQuote(quote: ShippingMethodQuote, currencyCode: CurrencyCode) {
        return {
            ...quote,
            customFields: this.shopVisibleCustomFields('ShippingMethod', quote.customFields),
            priceDecimal: this.decimal(quote.price),
            priceWithTaxDecimal: this.decimal(quote.priceWithTax),
            currencyCode,
        };
    }

    /** Same as `shippingQuote`: copies the quote and cuts `customFields` to what the Shop API shows. */
    paymentQuote(quote: PaymentMethodQuote) {
        return {
            ...quote,
            customFields: this.shopVisibleCustomFields('PaymentMethod', quote.customFields),
        };
    }

    // A shop caller never holds admin permissions, so anything permission-gated is hidden too.
    private shopVisibleCustomFields(
        entityName: keyof CustomFields,
        customFields: Record<string, unknown> | null | undefined,
    ) {
        if (customFields == null) {
            return customFields;
        }
        const configs = this.configService.customFields[entityName] ?? [];
        const visible: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(customFields)) {
            const config = configs.find(candidate => candidate.name === key);
            if (
                config &&
                config.internal !== true &&
                config.public !== false &&
                config.requiresPermission == null
            ) {
                visible[key] = value;
            }
        }
        return visible;
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
        };
    }
}
