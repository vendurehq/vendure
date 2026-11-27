import { Injectable } from '@nestjs/common';
import {
    ConfigurableOperation,
    ConfigurableOperationDefinition,
    OrderAddress,
    PaymentMethodQuote,
    ShippingMethodQuote,
} from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import {
    Address,
    Asset,
    Channel,
    Collection,
    ConfigArgService,
    ConfigDefType,
    ConfigService,
    Country,
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
    PaymentMethod,
    Product,
    ProductOptionGroup,
    ProductVariant,
    Refund,
    Role,
    ShippingMethod,
    StockLevel,
    StockLocation,
    TaxCategory,
    TaxRate,
    Zone,
} from '@vendure/core';
import { toDecimalString } from '@vendure/mcp-sdk';

import { redactArgValue, secretConfigArgsOf } from '../../config-arg-secrets';

/** How much of a product's description a list item keeps; `get_product` has the whole text. */
const LIST_ITEM_DESCRIPTION_LENGTH = 200;

// Every built-in tool that returns an entity goes through this service, so each entity's output
// shape has a single definition. It needs to be injectable because prices need the store's
// configured decimal places, which only ConfigService can provide.
@Injectable()
export class McpToolSerializerService {
    constructor(
        private readonly configService: ConfigService,
        private readonly configArgService: ConfigArgService,
    ) {}

    // Tool results carry the raw whole-number amount as well as this formatted string, so a
    // language model can quote a price without doing the division itself.
    decimal(value: number | undefined | null): string {
        const precision = this.configService.entityOptions.moneyStrategy.precision ?? 2;
        return toDecimalString(value, precision);
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
                      shippingOptionCode: line.shippingOptionCode,
                      shippingOptionName: line.shippingOptionName,
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
            options: quote.options.map(option => ({
                ...option,
                priceDecimal: this.decimal(option.price),
                priceWithTaxDecimal: this.decimal(option.priceWithTax),
            })),
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
     * A channel with its store settings. `channel()` stays small because `list_channels` and
     * `set_active_channel` only need the code and the token.
     */
    channelDetails(channel: Channel) {
        return {
            ...this.channel(channel),
            defaultLanguageCode: channel.defaultLanguageCode,
            availableLanguageCodes: channel.availableLanguageCodes,
            defaultCurrencyCode: channel.defaultCurrencyCode,
            availableCurrencyCodes: channel.availableCurrencyCodes,
            pricesIncludeTax: channel.pricesIncludeTax,
            taxCountryCode: channel.taxCountryCode ?? null,
            defaultTaxZone: channel.defaultTaxZone ? this.zoneReference(channel.defaultTaxZone) : null,
            defaultShippingZone: channel.defaultShippingZone
                ? this.zoneReference(channel.defaultShippingZone)
                : null,
            trackInventory: channel.trackInventory,
            outOfStockThreshold: channel.outOfStockThreshold,
        };
    }

    // Errors are returned directly so the registry can report them as failed tool calls.
    channelOrError(result: Channel | GraphQLErrorResult) {
        if (!isGraphQlErrorResult(result)) {
            return { channel: this.channelDetails(result) };
        }
        return { ...result };
    }

    private zoneReference(zone: Zone) {
        return { id: zone.id, name: zone.name };
    }

    /** Members are listed by country code, which is what `create_zone` and `update_zone` take. */
    zone(zone: Zone) {
        return {
            id: zone.id,
            name: zone.name,
            memberCountryCodes: (zone.members ?? []).map(member => member.code),
        };
    }

    country(country: Country) {
        return { id: country.id, code: country.code, name: country.name, enabled: country.enabled };
    }

    taxCategory(category: TaxCategory) {
        return { id: category.id, name: category.name, isDefault: category.isDefault };
    }

    /** A rate targets either a zone or a single country, never both. */
    taxRate(rate: TaxRate) {
        return {
            id: rate.id,
            name: rate.name,
            enabled: rate.enabled,
            value: rate.value,
            taxCategory: rate.category ? { id: rate.category.id, name: rate.category.name } : null,
            target: rate.region
                ? { countryCode: rate.region.code }
                : rate.zone
                  ? { zoneId: rate.zone.id, zoneName: rate.zone.name }
                  : null,
            customerGroupId: rate.customerGroup?.id ?? null,
        };
    }

    shippingMethod(method: ShippingMethod) {
        return {
            id: method.id,
            code: method.code,
            name: method.name,
            description: method.description,
            fulfillmentHandlerCode: method.fulfillmentHandlerCode,
            checker: this.configurableOperation('ShippingEligibilityChecker', method.checker),
            calculator: this.configurableOperation('ShippingCalculator', method.calculator),
        };
    }

    paymentMethod(method: PaymentMethod) {
        return {
            id: method.id,
            code: method.code,
            name: method.name,
            description: method.description,
            enabled: method.enabled,
            checker: method.checker
                ? this.configurableOperation('PaymentMethodEligibilityChecker', method.checker)
                : null,
            handler: this.configurableOperation('PaymentMethodHandler', method.handler),
        };
    }

    stockLocation(location: StockLocation) {
        return { id: location.id, name: location.name, description: location.description };
    }

    role(role: Role) {
        return {
            id: role.id,
            code: role.code,
            description: role.description,
            permissions: role.permissions,
            channelId: role.channelId,
        };
    }

    /**
     * Arguments come back by name, in the same shape the create and update tools take. Core stores
     * every value as a string. A number, boolean or list argument is returned parsed, and any other
     * argument as the stored string, so sending a value back unchanged stores the same value.
     *
     * A set `secret` argument is always replaced with the redaction placeholder: a tool result goes
     * to a language model, so no tool reveals a secret, whatever the configured secret access
     * strategy allows. Sending the placeholder back in an update keeps the stored value. An unset
     * secret is returned as it is, so a caller can see that it is missing.
     */
    private configurableOperation(type: ConfigDefType, operation: ConfigurableOperation) {
        const definitions = this.configArgService.getDefinitions(type) as Array<{
            code: string;
            args: Record<string, { type: string; list?: boolean }>;
        }>;
        const definition = definitions.find(candidate => candidate.code === operation.code);
        const isSecret = secretConfigArgsOf(this.configArgService);
        const args: Record<string, unknown> = {};
        for (const arg of operation.args) {
            const value = redactArgValue(operation.code, arg.name, arg.value, isSecret);
            args[arg.name] =
                value === REDACTED_SECRET_PLACEHOLDER
                    ? value
                    : this.configArgValue(arg.value, definition?.args[arg.name]);
        }
        return { code: operation.code, args };
    }

    private configArgValue(value: string, definition: { type: string; list?: boolean } | undefined): unknown {
        const parsed = definition?.list || ['int', 'float', 'boolean'].includes(definition?.type ?? '');
        if (!parsed) {
            return value;
        }
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    /** What `list_shipping_options` and `list_payment_options` return for each operation. */
    configurableOperationDefinition(definition: ConfigurableOperationDefinition) {
        return {
            code: definition.code,
            description: definition.description,
            args: definition.args.map(arg => ({
                name: arg.name,
                type: arg.type,
                list: arg.list,
                required: arg.required,
                defaultValue: arg.defaultValue ?? null,
                description: arg.description ?? null,
            })),
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
        };
    }
}
