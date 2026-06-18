import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { CustomOrderLineFields, Order, OrderLine, ProductVariant } from '../../entity/index';

export interface WillAddItemToOrderInput {
    productVariant: ProductVariant;
    quantity: number;
    customFields?: CustomOrderLineFields;
}

export interface WillAdjustOrderLineInput {
    orderLine: OrderLine;
    quantity: number;
    customFields?: CustomOrderLineFields;
}

/**
 * @description
 * An OrderInterceptor is a class which can be used to intercept and modify the behavior of order-related
 * operations.
 *
 * It does this by providing methods which are called whenever the contents of an order are about
 * to get changed. These methods are able to prevent the operation from proceeding by returning a string
 * error message.
 *
 * Examples of use-cases for an OrderInterceptor include:
 *
 * * Preventing certain products from being added to the order based on some criteria, e.g. if the
 *   product is already in another active order.
 * * Enforcing a minimum or maximum quantity of a given product in the order
 * * Using a CAPTCHA to prevent automated order creation
 *
 * :::info
 *
 * This is configured via the `orderOptions.orderInterceptors` property of
 * your VendureConfig.
 *
 * :::
 *
 * OrderInterceptors are executed when the following mutations are called:
 *
 * - `addItemToOrder`
 * - `adjustOrderLine`
 * - `removeItemFromOrder`
 *
 * Additionally, if you are working directly with the {@link OrderService}, the following methods will trigger
 * any registered OrderInterceptors:
 *
 * - `addItemToOrder`
 * - `addItemsToOrder`
 * - `adjustOrderLine`
 * - `adjustOrderLines`
 * - `removeItemFromOrder`
 * - `removeItemsFromOrder`
 *
 * When an OrderInterceptor is registered, it will be called in the order in which it was registered.
 * If an interceptor method resolves to a string, the operation will be prevented and the string will be used as the error message.
 *
 * When multiple interceptors are registered, the first interceptor to resolve to a string will prevent the operation from proceeding.
 *
 * Errors returned by OrderInterceptors are surfaced to the GraphQL API as an `OrderInterceptorError` and can be
 * queried like this:
 *
 * ```graphql
 * mutation AddItemToOrder($productVariantId: ID!, $quantity: Int!) {
 *   addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
 *     ... on Order {
 *       id
 *       code
 *       # ... other Order fields
 *     }
 *     ... on ErrorResult {
 *       errorCode
 *       message
 *     }
 *     ... on OrderInterceptorError { # [!code highlight]
 *       interceptorError # [!code highlight]
 *     } # [!code highlight]
 *   }
 * }
 * ```
 *
 * In the above example, the error message returned by the OrderInterceptor would be available in the `interceptorError` field.
 *
 * ## Example: Min/max order quantity
 *
 * Let's say we want to allow ProductVariants to specify the minimum or maximum amount which may be added
 * to an order. We can define custom fields to store this information and
 * then use this custom field value to prevent an order line from being added to the order if the quantity
 * is below the minimum.
 *
 * @example
 * ```ts
 * import {
 *   EntityHydrator,
 *   Injector,
 *   LanguageCode,
 *   Order,
 *   OrderInterceptor,
 *   ProductVariant,
 *   RequestContext,
 *   TranslatorService,
 *   VendurePlugin,
 *   WillAddItemToOrderInput,
 *   WillAdjustOrderLineInput,
 * } from '\@vendure/core';
 *
 * declare module '\@vendure/core/dist/entity/custom-entity-fields' {
 *   interface CustomProductVariantFields {
 *     minOrderQuantity?: number;
 *     maxOrderQuantity?: number;
 *   }
 * }
 *
 * // This OrderInterceptor enforces minimum and maximum order quantities on ProductVariants.
 * export class MinMaxOrderInterceptor implements OrderInterceptor {
 *  private entityHydrator: EntityHydrator;
 *  private translatorService: TranslatorService;
 *
 *  init(injector: Injector) {
 *    this.entityHydrator = injector.get(EntityHydrator);
 *    this.translatorService = injector.get(TranslatorService);
 *  }
 *
 *  willAddItemToOrder(
 *    ctx: RequestContext,
 *    order: Order,
 *    input: WillAddItemToOrderInput,
 *  ): Promise<void | string> | void | string {
 *    const { productVariant, quantity } = input;
 *    const min = productVariant.customFields?.minOrderQuantity;
 *    const max = productVariant.customFields?.maxOrderQuantity;
 *    if (min && quantity < min) {
 *      return this.minErrorMessage(ctx, productVariant, min);
 *    }
 *    if (max && quantity > max) {
 *      return this.maxErrorMessage(ctx, productVariant, max);
 *    }
 *  }
 *
 *  willAdjustOrderLine(
 *    ctx: RequestContext,
 *    order: Order,
 *    input: WillAdjustOrderLineInput,
 *  ): Promise<void | string> | void | string {
 *    const { orderLine, quantity } = input;
 *    const min = orderLine.productVariant.customFields?.minOrderQuantity;
 *    const max = orderLine.productVariant.customFields?.maxOrderQuantity;
 *    if (min && quantity < min) {
 *      return this.minErrorMessage(ctx, orderLine.productVariant, min);
 *    }
 *    if (max && quantity > max) {
 *      return this.maxErrorMessage(ctx, orderLine.productVariant, max);
 *    }
 *  }
 *
 *  private async minErrorMessage(ctx: RequestContext, variant: ProductVariant, min: number) {
 *    const variantName = await this.getTranslatedVariantName(ctx, variant);
 *    return `Minimum order quantity for "${variantName}" is ${min}`;
 *  }
 *
 *  private async maxErrorMessage(ctx: RequestContext, variant: ProductVariant, max: number) {
 *    const variantName = await this.getTranslatedVariantName(ctx, variant);
 *    return `Maximum order quantity for "${variantName}" is ${max}`;
 *  }
 *
 *  private async getTranslatedVariantName(ctx: RequestContext, variant: ProductVariant) {
 *    await this.entityHydrator.hydrate(ctx, variant, { relations: ['translations'] });
 *    const translated = this.translatorService.translate(variant, ctx);
 *    return translated.name;
 *  }
 * }
 *
 * // This plugin enforces minimum and maximum order quantities on ProductVariants.
 * // It adds two new custom fields to ProductVariant:
 * // - minOrderQuantity
 * // - maxOrderQuantity
 * //
 * // It also adds an OrderInterceptor which enforces these limits.
 * \@VendurePlugin({
 *  configuration: config => {
 *  // Here we add the custom fields to the ProductVariant entity
 *    config.customFields.ProductVariant.push({
 *      type: 'int',
 *      min: 0,
 *      name: 'minOrderQuantity',
 *      label: [{ languageCode: LanguageCode.en, value: 'Minimum order quantity' }],
 *      nullable: true,
 *    });
 *    config.customFields.ProductVariant.push({
 *      type: 'int',
 *      min: 0,
 *      name: 'maxOrderQuantity',
 *      label: [{ languageCode: LanguageCode.en, value: 'Maximum order quantity' }],
 *      nullable: true,
 *    });
 *
 *    // Here we add the MinMaxOrderInterceptor to the orderInterceptors array
 *    config.orderOptions.orderInterceptors.push(new MinMaxOrderInterceptor());
 *    return config;
 *  },
 * })
 * export class OrderQuantityLimitsPlugin {}
 * ```
 *
 *
 * @docsCategory orders
 * @docsPage OrderInterceptor
 * @docsWeight 0
 * @since 3.1.0
 */
export interface OrderInterceptor extends InjectableStrategy {
    /**
     * @description
     * Called when a new item is about to be added to the order,
     * as in the `addItemToOrder` mutation or the `addItemToOrder()` / `addItemsToOrder()` method
     * of the {@link OrderService}.
     */
    willAddItemToOrder?(
        ctx: RequestContext,
        order: Order,
        input: WillAddItemToOrderInput,
    ): Promise<void | string> | void | string;

    /**
     * @description
     * Called when an existing order line is about to be adjusted,
     * as in the `adjustOrderLine` mutation or the `adjustOrderLine()` / `adjustOrderLines()` method
     * of the {@link OrderService}.
     */
    willAdjustOrderLine?(
        ctx: RequestContext,
        order: Order,
        input: WillAdjustOrderLineInput,
    ): Promise<void | string> | void | string;

    /**
     * @description
     * Called when an item is about to be removed from the order,
     * as in the `removeItemFromOrder` mutation or the `removeItemFromOrder()` / `removeItemsFromOrder()` method
     * of the {@link OrderService}.
     */
    willRemoveItemFromOrder?(
        ctx: RequestContext,
        order: Order,
        orderLine: OrderLine,
    ): Promise<void | string> | void | string;
}
