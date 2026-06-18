import { Injectable } from '@nestjs/common';
import {
    AdjustmentType,
    CancelOrderInput,
    HistoryEntryType,
    ModifyOrderInput,
    ModifyOrderResult,
    OrderLineInput,
    RefundOrderInput,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { getGraphQlInputName, summate } from '@vendure/common/lib/shared-utils';
import { IsNull } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { isGraphQlErrorResult, JustErrorResults } from '../../../common/error/error-result';
import { EntityNotFoundError, InternalServerError, UserInputError } from '../../../common/error/errors';
import {
    CancelActiveOrderError,
    CouponCodeExpiredError,
    CouponCodeInvalidError,
    CouponCodeLimitError,
    EmptyOrderLineSelectionError,
    MultipleOrderError,
    NoChangesSpecifiedError,
    OrderModificationStateError,
    QuantityTooGreatError,
    RefundPaymentIdMissingError,
} from '../../../common/error/generated-graphql-admin-errors';
import {
    IneligibleShippingMethodError,
    InsufficientStockError,
    NegativeQuantityError,
    OrderLimitError,
} from '../../../common/error/generated-graphql-shop-errors';
import { Instrument } from '../../../common/instrument-decorator';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { CustomFieldConfig } from '../../../config/custom-field/custom-field-types';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { VendureEntity } from '../../../entity/base/base.entity';
import { FulfillmentLine } from '../../../entity/order-line-reference/fulfillment-line.entity';
import { OrderModificationLine } from '../../../entity/order-line-reference/order-modification-line.entity';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { OrderModification } from '../../../entity/order-modification/order-modification.entity';
import { Order } from '../../../entity/order/order.entity';
import { Payment } from '../../../entity/payment/payment.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { ShippingLine } from '../../../entity/shipping-line/shipping-line.entity';
import { Allocation } from '../../../entity/stock-movement/allocation.entity';
import { Cancellation } from '../../../entity/stock-movement/cancellation.entity';
import { Release } from '../../../entity/stock-movement/release.entity';
import { Sale } from '../../../entity/stock-movement/sale.entity';
import { Surcharge } from '../../../entity/surcharge/surcharge.entity';
import { OrderEvent } from '../../../event-bus';
import { EventBus } from '../../../event-bus/event-bus';
import { OrderLineEvent } from '../../../event-bus/events/order-line-event';
import { CountryService } from '../../services/country.service';
import { HistoryService } from '../../services/history.service';
import { PaymentService } from '../../services/payment.service';
import { ProductVariantService } from '../../services/product-variant.service';
import { PromotionService } from '../../services/promotion.service';
import { StockMovementService } from '../../services/stock-movement.service';
import { CustomFieldRelationService } from '../custom-field-relation/custom-field-relation.service';
import { OrderCalculator } from '../order-calculator/order-calculator';
import { ShippingCalculator } from '../shipping-calculator/shipping-calculator';
import { TranslatorService } from '../translator/translator.service';
import { getOrdersFromLines, orderLinesAreAllCancelled } from '../utils/order-utils';
import { patchEntity } from '../utils/patch-entity';

/**
 * @description
 * This helper is responsible for modifying the contents of an Order.
 *
 * Note:
 * There is not a clear separation of concerns between the OrderService and this, since
 * the OrderService also contains some method which modify the Order (e.g. removeItemFromOrder).
 * So this helper was mainly extracted to isolate the huge `modifyOrder` method since the
 * OrderService was just growing too large. Future refactoring could improve the organization
 * of these Order-related methods into a more clearly-delineated set of classes.
 *
 * @docsCategory service-helpers
 */
@Injectable()
@Instrument()
export class OrderModifier {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private orderCalculator: OrderCalculator,
        private paymentService: PaymentService,
        private countryService: CountryService,
        private stockMovementService: StockMovementService,
        private productVariantService: ProductVariantService,
        private customFieldRelationService: CustomFieldRelationService,
        private promotionService: PromotionService,
        private eventBus: EventBus,
        private shippingCalculator: ShippingCalculator,
        private historyService: HistoryService,
        private translator: TranslatorService,
    ) {}

    /**
     * @description
     * Ensure that the ProductVariant has sufficient saleable stock to add the given
     * quantity to an Order.
     *
     * - `existingOrderLineQuantity` is used when adding an item to the order, since if an OrderLine
     * already exists then we will be adding the new quantity to the existing quantity.
     * - `quantityInOtherOrderLines` is used when we have more than 1 OrderLine containing the same
     * ProductVariant. This occurs when there are custom fields defined on the OrderLine and the lines
     * have differing values for one or more custom fields. In this case, we need to take _all_ of these
     * OrderLines into account when constraining the quantity. See https://github.com/vendurehq/vendure/issues/2702
     * for more on this.
     */
    async constrainQuantityToSaleable(
        ctx: RequestContext,
        variant: ProductVariant,
        quantity: number,
        existingOrderLineQuantity = 0,
        quantityInOtherOrderLines = 0,
    ) {
        let correctedQuantity = quantity + existingOrderLineQuantity;
        const saleableStockLevel = await this.productVariantService.getSaleableStockLevel(ctx, variant);
        if (saleableStockLevel < correctedQuantity + quantityInOtherOrderLines) {
            correctedQuantity = Math.max(
                saleableStockLevel - existingOrderLineQuantity - quantityInOtherOrderLines,
                0,
            );
        }
        return correctedQuantity;
    }

    /**
     * @description
     * Given a ProductVariant ID and optional custom fields, this method will return an existing OrderLine that
     * matches, or `undefined` if no match is found.
     */
    async getExistingOrderLine(
        ctx: RequestContext,
        order: Order,
        productVariantId: ID,
        customFields?: { [key: string]: any },
    ): Promise<OrderLine | undefined> {
        for (const line of order.lines) {
            const match =
                idsAreEqual(line.productVariantId, productVariantId) &&
                (await this.customFieldsAreEqual(ctx, line, customFields, line.customFields));
            if (match) {
                return line;
            }
        }
    }

    /**
     * @description
     * Returns the OrderLine containing the given {@link ProductVariant}, taking into account any custom field values. If no existing
     * OrderLine is found, a new OrderLine will be created.
     */
    async getOrCreateOrderLine(
        ctx: RequestContext,
        order: Order,
        productVariantId: ID,
        customFields?: { [key: string]: any },
    ) {
        const existingOrderLine = await this.getExistingOrderLine(ctx, order, productVariantId, customFields);
        if (existingOrderLine) {
            return existingOrderLine;
        }

        const productVariant = await this.getProductVariantOrThrow(ctx, productVariantId, order);
        const featuredAssetId = productVariant.featuredAssetId ?? productVariant.product.featuredAssetId;
        const orderLine = await this.connection.getRepository(ctx, OrderLine).save(
            new OrderLine({
                productVariant,
                taxCategory: productVariant.taxCategory,
                featuredAsset: featuredAssetId ? { id: featuredAssetId } : undefined,
                listPrice: productVariant.listPrice,
                listPriceIncludesTax: productVariant.listPriceIncludesTax,
                adjustments: [],
                taxLines: [],
                customFields,
                quantity: 0,
            }),
        );
        const { orderSellerStrategy } = this.configService.orderOptions;
        if (typeof orderSellerStrategy.setOrderLineSellerChannel === 'function') {
            orderLine.sellerChannel = await orderSellerStrategy.setOrderLineSellerChannel(ctx, orderLine);
            await this.connection
                .getRepository(ctx, OrderLine)
                .createQueryBuilder()
                .relation('sellerChannel')
                .of(orderLine)
                .set(orderLine.sellerChannel);
        }
        await this.customFieldRelationService.updateRelations(ctx, OrderLine, { customFields }, orderLine);
        order.lines.push(orderLine);
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder()
            .relation('lines')
            .of(order)
            .add(orderLine);
        await this.eventBus.publish(new OrderLineEvent(ctx, order, orderLine, 'created'));
        return orderLine;
    }

    /**
     * @description
     * Updates the quantity of an OrderLine, taking into account the available saleable stock level.
     * Returns the actual quantity that the OrderLine was updated to (which may be less than the
     * `quantity` argument if insufficient stock was available.
     */
    async updateOrderLineQuantity(
        ctx: RequestContext,
        orderLine: OrderLine,
        quantity: number,
        order: Order,
    ): Promise<OrderLine> {
        const currentQuantity = orderLine.quantity;
        orderLine.quantity = quantity;
        if (currentQuantity < quantity) {
            if (!order.active && order.state !== 'Draft') {
                await this.stockMovementService.createAllocationsForOrderLines(ctx, [
                    {
                        orderLineId: orderLine.id,
                        quantity: quantity - currentQuantity,
                    },
                ]);
            }
        } else if (quantity < currentQuantity) {
            if (!order.active && order.state !== 'Draft') {
                // When an Order is not active (i.e. Customer checked out), then we don't want to just
                // delete the OrderItems - instead we will cancel them
                // const toSetAsCancelled = orderLine.items.filter(i => !i.cancelled).slice(quantity);
                // const fulfilledItems = toSetAsCancelled.filter(i => !!i.fulfillment);
                // const allocatedItems = toSetAsCancelled.filter(i => !i.fulfillment);
                await this.stockMovementService.createCancellationsForOrderLines(ctx, [
                    { orderLineId: orderLine.id, quantity },
                ]);
                await this.stockMovementService.createReleasesForOrderLines(ctx, [
                    { orderLineId: orderLine.id, quantity },
                ]);
            }
        }
        await this.connection.getRepository(ctx, OrderLine).save(orderLine);
        await this.eventBus.publish(new OrderLineEvent(ctx, order, orderLine, 'updated'));
        return orderLine;
    }

    async cancelOrderByOrderLines(
        ctx: RequestContext,
        input: CancelOrderInput,
        lineInputs: OrderLineInput[],
    ) {
        if (lineInputs.length === 0 || summate(lineInputs, 'quantity') === 0) {
            return new EmptyOrderLineSelectionError();
        }
        const orders = await getOrdersFromLines(ctx, this.connection, lineInputs);
        if (1 < orders.length) {
            return new MultipleOrderError();
        }
        const order = orders[0];
        if (!idsAreEqual(order.id, input.orderId)) {
            return new MultipleOrderError();
        }
        if (order.active) {
            return new CancelActiveOrderError({ orderState: order.state });
        }
        const fullOrder = await this.connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: ['lines'],
        });

        const allocatedLines: OrderLineInput[] = [];
        const fulfilledLines: OrderLineInput[] = [];
        for (const lineInput of lineInputs) {
            const orderLine = fullOrder.lines.find(l => idsAreEqual(l.id, lineInput.orderLineId));
            if (orderLine && orderLine.quantity < lineInput.quantity) {
                return new QuantityTooGreatError();
            }
            const allocationsForLine = await this.connection
                .getRepository(ctx, Allocation)
                .createQueryBuilder('allocation')
                .leftJoinAndSelect('allocation.orderLine', 'orderLine')
                .where('orderLine.id = :orderLineId', { orderLineId: lineInput.orderLineId })
                .getMany();
            const salesForLine = await this.connection
                .getRepository(ctx, Sale)
                .createQueryBuilder('sale')
                .leftJoinAndSelect('sale.orderLine', 'orderLine')
                .where('orderLine.id = :orderLineId', { orderLineId: lineInput.orderLineId })
                .getMany();
            const releasesForLine = await this.connection
                .getRepository(ctx, Release)
                .createQueryBuilder('release')
                .leftJoinAndSelect('release.orderLine', 'orderLine')
                .where('orderLine.id = :orderLineId', { orderLineId: lineInput.orderLineId })
                .getMany();
            const totalAllocated =
                summate(allocationsForLine, 'quantity') +
                summate(salesForLine, 'quantity') -
                summate(releasesForLine, 'quantity');
            if (0 < totalAllocated) {
                allocatedLines.push({
                    orderLineId: lineInput.orderLineId,
                    quantity: Math.min(totalAllocated, lineInput.quantity),
                });
            }
            const fulfillmentsForLine = await this.connection
                .getRepository(ctx, FulfillmentLine)
                .createQueryBuilder('fulfillmentLine')
                .leftJoinAndSelect('fulfillmentLine.orderLine', 'orderLine')
                .where('orderLine.id = :orderLineId', { orderLineId: lineInput.orderLineId })
                .getMany();
            const cancellationsForLine = await this.connection
                .getRepository(ctx, Cancellation)
                .createQueryBuilder('cancellation')
                .leftJoinAndSelect('cancellation.orderLine', 'orderLine')
                .where('orderLine.id = :orderLineId', { orderLineId: lineInput.orderLineId })
                .getMany();
            const totalFulfilled =
                summate(fulfillmentsForLine, 'quantity') - summate(cancellationsForLine, 'quantity');
            if (0 < totalFulfilled) {
                fulfilledLines.push({
                    orderLineId: lineInput.orderLineId,
                    quantity: Math.min(totalFulfilled, lineInput.quantity),
                });
            }
        }
        await this.stockMovementService.createCancellationsForOrderLines(ctx, fulfilledLines);
        await this.stockMovementService.createReleasesForOrderLines(ctx, allocatedLines);
        for (const line of lineInputs) {
            const orderLine = fullOrder.lines.find(l => idsAreEqual(l.id, line.orderLineId));
            if (orderLine) {
                await this.connection.getRepository(ctx, OrderLine).update(line.orderLineId, {
                    quantity: orderLine.quantity - line.quantity,
                });

                await this.eventBus.publish(new OrderLineEvent(ctx, order, orderLine, 'cancelled'));
            }
        }

        const orderWithLines = await this.connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: ['lines', 'surcharges', 'shippingLines'],
        });
        if (input.cancelShipping === true) {
            for (const shippingLine of orderWithLines.shippingLines) {
                shippingLine.adjustments.push({
                    adjustmentSource: 'CANCEL_ORDER',
                    type: AdjustmentType.OTHER,
                    description: 'shipping cancellation',
                    amount: -shippingLine.discountedPrice,
                    data: {},
                });
                await this.connection.getRepository(ctx, ShippingLine).save(shippingLine, { reload: false });
            }
        }
        // Update totals after cancellation
        this.orderCalculator.calculateOrderTotals(orderWithLines);
        await this.connection.getRepository(ctx, Order).save(orderWithLines, { reload: false });

        await this.historyService.createHistoryEntryForOrder({
            ctx,
            orderId: order.id,
            type: HistoryEntryType.ORDER_CANCELLATION,
            data: {
                lines: lineInputs,
                reason: input.reason || undefined,
                shippingCancelled: !!input.cancelShipping,
            },
        });

        return orderLinesAreAllCancelled(orderWithLines);
    }

    async modifyOrder(
        ctx: RequestContext,
        input: ModifyOrderInput,
        order: Order,
    ): Promise<JustErrorResults<ModifyOrderResult> | { order: Order; modification: OrderModification }> {
        const { dryRun } = input;
        const modification = new OrderModification({
            order,
            note: input.note || '',
            lines: [],
            surcharges: [],
        });
        const initialTotalWithTax = order.totalWithTax;
        const initialShippingWithTax = order.shippingWithTax;
        if (order.state !== 'Modifying') {
            return new OrderModificationStateError();
        }
        if (this.noChangesSpecified(input)) {
            return new NoChangesSpecifiedError();
        }
        const { orderItemsLimit } = this.configService.orderOptions;
        let currentItemsCount = summate(order.lines, 'quantity');
        const updatedOrderLineIds: ID[] = [];
        const refundInputArray = Array.isArray(input.refunds)
            ? input.refunds
            : input.refund
              ? [input.refund]
              : [];
        const refundInputs: RefundOrderInput[] = refundInputArray.map(refund => ({
            lines: [],
            adjustment: 0,
            shipping: 0,
            paymentId: refund.paymentId,
            amount: refund.amount,
            reason: refund.reason || input.note,
        }));

        for (const row of input.addItems ?? []) {
            const { productVariantId, quantity } = row;
            if (quantity < 0) {
                return new NegativeQuantityError();
            }

            const customFields = (row as any).customFields || {};
            const orderLine = await this.getOrCreateOrderLine(ctx, order, productVariantId, customFields);
            const correctedQuantity = await this.constrainQuantityToSaleable(
                ctx,
                orderLine.productVariant,
                quantity,
            );
            if (orderItemsLimit < currentItemsCount + correctedQuantity) {
                return new OrderLimitError({ maxItems: orderItemsLimit });
            } else {
                currentItemsCount += correctedQuantity;
            }
            if (correctedQuantity < quantity) {
                return new InsufficientStockError({ quantityAvailable: correctedQuantity, order });
            }
            updatedOrderLineIds.push(orderLine.id);
            const initialQuantity = orderLine.quantity;
            await this.updateOrderLineQuantity(ctx, orderLine, initialQuantity + correctedQuantity, order);

            const orderModificationLine = await this.connection
                .getRepository(ctx, OrderModificationLine)
                .save(new OrderModificationLine({ orderLine, quantity: quantity - initialQuantity }));
            modification.lines.push(orderModificationLine);
        }

        for (const row of input.adjustOrderLines ?? []) {
            const { orderLineId, quantity } = row;
            if (quantity < 0) {
                return new NegativeQuantityError();
            }
            const orderLine = order.lines.find(line => idsAreEqual(line.id, orderLineId));
            if (!orderLine) {
                throw new UserInputError('error.order-does-not-contain-line-with-id', { id: orderLineId });
            }
            const initialLineQuantity = orderLine.quantity;
            let correctedQuantity = quantity;
            if (initialLineQuantity < quantity) {
                const additionalQuantity = await this.constrainQuantityToSaleable(
                    ctx,
                    orderLine.productVariant,
                    quantity - initialLineQuantity,
                );
                correctedQuantity = initialLineQuantity + additionalQuantity;
            }
            const resultingOrderTotalQuantity = currentItemsCount + correctedQuantity - orderLine.quantity;
            if (orderItemsLimit < resultingOrderTotalQuantity) {
                return new OrderLimitError({ maxItems: orderItemsLimit });
            } else {
                currentItemsCount += correctedQuantity;
            }
            if (correctedQuantity < quantity) {
                return new InsufficientStockError({ quantityAvailable: correctedQuantity, order });
            } else {
                const customFields = (row as any).customFields;
                if (customFields) {
                    patchEntity(orderLine, { customFields });
                }
                if (quantity < initialLineQuantity) {
                    const cancelLinesInput = [
                        {
                            orderLineId,
                            quantity: initialLineQuantity - quantity,
                        },
                    ];
                    await this.cancelOrderByOrderLines(ctx, { orderId: order.id }, cancelLinesInput);
                    orderLine.quantity = quantity;
                } else {
                    await this.updateOrderLineQuantity(ctx, orderLine, quantity, order);
                }
                const orderModificationLine = await this.connection
                    .getRepository(ctx, OrderModificationLine)
                    .save(new OrderModificationLine({ orderLine, quantity: quantity - initialLineQuantity }));
                modification.lines.push(orderModificationLine);

                if (correctedQuantity < initialLineQuantity) {
                    const qtyDelta = initialLineQuantity - correctedQuantity;

                    refundInputs.forEach(ri => {
                        ri.lines?.push({
                            orderLineId: orderLine.id,
                            quantity: qtyDelta,
                        });
                    });
                }
            }
            updatedOrderLineIds.push(orderLine.id);
        }

        for (const surchargeInput of input.surcharges ?? []) {
            const taxLines =
                surchargeInput.taxRate != null
                    ? [
                          {
                              taxRate: surchargeInput.taxRate,
                              description: surchargeInput.taxDescription || '',
                          },
                      ]
                    : [];
            const surcharge = await this.connection.getRepository(ctx, Surcharge).save(
                new Surcharge({
                    sku: surchargeInput.sku || '',
                    description: surchargeInput.description,
                    listPrice: surchargeInput.price,
                    listPriceIncludesTax: surchargeInput.priceIncludesTax,
                    taxLines,
                    order,
                }),
            );
            order.surcharges.push(surcharge);
            modification.surcharges.push(surcharge);
            if (surcharge.priceWithTax < 0) {
                refundInputs.forEach(ri => {
                    if (ri.adjustment != null) {
                        ri.adjustment += Math.abs(surcharge.priceWithTax);
                    }
                });
            }
        }
        if (input.surcharges?.length) {
            await this.connection.getRepository(ctx, Order).save(order, { reload: false });
        }

        if (input.updateShippingAddress) {
            order.shippingAddress = {
                ...order.shippingAddress,
                ...input.updateShippingAddress,
            };
            if (input.updateShippingAddress.countryCode) {
                const country = await this.countryService.findOneByCode(
                    ctx,
                    input.updateShippingAddress.countryCode,
                );
                order.shippingAddress.country = country.name;
            }
            await this.connection.getRepository(ctx, Order).save(order, { reload: false });
            modification.shippingAddressChange = input.updateShippingAddress;
        }

        if (input.updateBillingAddress) {
            order.billingAddress = {
                ...order.billingAddress,
                ...input.updateBillingAddress,
            };
            if (input.updateBillingAddress.countryCode) {
                const country = await this.countryService.findOneByCode(
                    ctx,
                    input.updateBillingAddress.countryCode,
                );
                order.billingAddress.country = country.name;
            }
            await this.connection.getRepository(ctx, Order).save(order, { reload: false });
            modification.billingAddressChange = input.updateBillingAddress;
        }

        if (input.couponCodes) {
            for (const couponCode of input.couponCodes) {
                const validationResult = await this.promotionService.validateCouponCode(
                    ctx,
                    couponCode,
                    order.customer && order.customer.id,
                );
                if (isGraphQlErrorResult(validationResult)) {
                    return validationResult as
                        | CouponCodeExpiredError
                        | CouponCodeInvalidError
                        | CouponCodeLimitError;
                }
                if (!order.couponCodes.includes(couponCode)) {
                    // This is a new coupon code that hadn't been applied before
                    await this.historyService.createHistoryEntryForOrder({
                        ctx,
                        orderId: order.id,
                        type: HistoryEntryType.ORDER_COUPON_APPLIED,
                        data: { couponCode, promotionId: validationResult.id },
                    });
                }
            }
            for (const existingCouponCode of order.couponCodes) {
                if (!input.couponCodes.includes(existingCouponCode)) {
                    // An existing coupon code has been removed
                    await this.historyService.createHistoryEntryForOrder({
                        ctx,
                        orderId: order.id,
                        type: HistoryEntryType.ORDER_COUPON_REMOVED,
                        data: { couponCode: existingCouponCode },
                    });
                }
            }
            order.couponCodes = input.couponCodes;
        }

        const updatedOrderLines = order.lines.filter(l => updatedOrderLineIds.includes(l.id));
        const promotions = await this.promotionService.getActivePromotionsInChannel(ctx);
        const activePromotionsPre = await this.promotionService.getActivePromotionsOnOrder(ctx, order.id);
        if (input.shippingMethodIds) {
            const result = await this.setShippingMethods(ctx, order, input.shippingMethodIds);
            if (isGraphQlErrorResult(result)) {
                return result;
            }
        }
        const { orderItemPriceCalculationStrategy } = this.configService.orderOptions;
        for (const orderLine of updatedOrderLines) {
            const variant = await this.productVariantService.applyChannelPriceAndTax(
                orderLine.productVariant,
                ctx,
                order,
            );
            const priceResult = await orderItemPriceCalculationStrategy.calculateUnitPrice(
                ctx,
                variant,
                orderLine.customFields || {},
                order,
                orderLine.quantity,
            );
            orderLine.listPrice = priceResult.price;
            orderLine.listPriceIncludesTax = priceResult.priceIncludesTax;
        }

        await this.orderCalculator.applyPriceAdjustments(ctx, order, promotions, updatedOrderLines, {
            recalculateShipping: input.options?.recalculateShipping,
        });
        await this.promotionService.runPromotionSideEffects(ctx, order, activePromotionsPre);
        await this.connection.getRepository(ctx, OrderLine).save(order.lines, { reload: false });
        const orderCustomFields = (input as any).customFields;
        if (orderCustomFields) {
            patchEntity(order, { customFields: orderCustomFields });
        }

        if (dryRun) {
            return { order, modification };
        }

        // Create the actual modification and commit all changes
        const newTotalWithTax = order.totalWithTax;
        const delta = newTotalWithTax - initialTotalWithTax;
        if (delta < 0) {
            if (refundInputs.length === 0) {
                return new RefundPaymentIdMissingError();
            }
            // If there are multiple refunds, we select the largest one as the
            // "primary" refund to associate with the OrderModification.
            const primaryRefund = refundInputs.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0))[0];

            // TODO: the following code can be removed once we remove the deprecated
            // support for "shipping" and "adjustment" input fields for refunds
            const shippingDelta = order.shippingWithTax - initialShippingWithTax;
            if (shippingDelta < 0) {
                primaryRefund.shipping = shippingDelta * -1;
            }
            if (primaryRefund.adjustment != null) {
                primaryRefund.adjustment += await this.calculateRefundAdjustment(ctx, delta, primaryRefund);
            }
            // end

            for (const refundInput of refundInputs) {
                const existingPayments = await this.getOrderPayments(ctx, order.id);
                const payment = existingPayments.find(p => idsAreEqual(p.id, refundInput.paymentId));
                if (payment) {
                    const refund = await this.paymentService.createRefund(ctx, refundInput, order, payment);
                    if (!isGraphQlErrorResult(refund)) {
                        if (idsAreEqual(payment.id, primaryRefund.paymentId)) {
                            modification.refund = refund;
                        }
                    } else {
                        throw new InternalServerError(refund.message);
                    }
                }
            }
        }

        modification.priceChange = delta;
        const createdModification = await this.connection
            .getRepository(ctx, OrderModification)
            .save(modification);
        await this.connection.getRepository(ctx, Order).save(order);
        await this.connection.getRepository(ctx, ShippingLine).save(order.shippingLines, { reload: false });
        await this.eventBus.publish(new OrderEvent(ctx, order, 'updated', input));
        return { order, modification: createdModification };
    }

    async setShippingMethods(ctx: RequestContext, order: Order, shippingMethodIds: ID[]) {
        for (const [i, shippingMethodId] of shippingMethodIds.entries()) {
            const shippingMethod = await this.shippingCalculator.getMethodIfEligible(
                ctx,
                order,
                shippingMethodId,
            );
            if (!shippingMethod) {
                return new IneligibleShippingMethodError();
            }
            let shippingLine: ShippingLine | undefined = order.shippingLines[i];
            if (shippingLine) {
                shippingLine.shippingMethod = shippingMethod;
                shippingLine.shippingMethodId = shippingMethod.id;
            } else {
                shippingLine = await this.connection.getRepository(ctx, ShippingLine).save(
                    new ShippingLine({
                        shippingMethod,
                        order,
                        adjustments: [],
                        listPrice: 0,
                        listPriceIncludesTax: ctx.channel.pricesIncludeTax,
                        taxLines: [],
                    }),
                );
                if (order.shippingLines) {
                    order.shippingLines.push(shippingLine);
                } else {
                    order.shippingLines = [shippingLine];
                }
            }

            await this.connection.getRepository(ctx, ShippingLine).save(shippingLine);
        }
        // remove any now-unused ShippingLines
        if (shippingMethodIds.length < order.shippingLines.length) {
            const shippingLinesToDelete = order.shippingLines.splice(shippingMethodIds.length - 1);
            await this.connection.getRepository(ctx, ShippingLine).remove(shippingLinesToDelete);
        }
        // assign the ShippingLines to the OrderLines
        await this.connection
            .getRepository(ctx, OrderLine)
            .createQueryBuilder('line')
            .update({ shippingLine: undefined })
            .whereInIds(order.lines.map(l => l.id))
            .execute();
        const { shippingLineAssignmentStrategy } = this.configService.shippingOptions;
        for (const shippingLine of order.shippingLines) {
            const orderLinesForShippingLine =
                await shippingLineAssignmentStrategy.assignShippingLineToOrderLines(ctx, shippingLine, order);
            await this.connection
                .getRepository(ctx, OrderLine)
                .createQueryBuilder('line')
                .update({ shippingLineId: shippingLine.id })
                .whereInIds(orderLinesForShippingLine.map(l => l.id))
                .execute();
            orderLinesForShippingLine.forEach(line => {
                line.shippingLine = shippingLine;
            });
        }
        return order;
    }

    private noChangesSpecified(input: ModifyOrderInput): boolean {
        const noChanges =
            !input.adjustOrderLines?.length &&
            !input.addItems?.length &&
            !input.surcharges?.length &&
            !input.updateShippingAddress &&
            !input.updateBillingAddress &&
            !input.couponCodes &&
            !(input as any).customFields &&
            (!input.shippingMethodIds || input.shippingMethodIds.length === 0);
        return noChanges;
    }

    /**
     * @description
     * Because a Refund's amount is calculated based on the orderItems changed, plus shipping change,
     * we need to make sure the amount gets adjusted to match any changes caused by other factors,
     * i.e. promotions that were previously active but are no longer.
     *
     * TODO: Deprecated - can be removed once we remove support for the "shipping" & "adjustment" input
     * fields for refunds.
     */
    private async calculateRefundAdjustment(
        ctx: RequestContext,
        delta: number,
        refundInput: RefundOrderInput,
    ): Promise<number> {
        const existingAdjustment = refundInput.adjustment ?? 0;

        let itemAmount = 0; // TODO: figure out what this should be
        for (const lineInput of refundInput.lines ?? []) {
            const orderLine = await this.connection.getEntityOrThrow(ctx, OrderLine, lineInput.orderLineId);
            itemAmount += orderLine.proratedUnitPriceWithTax * lineInput.quantity;
        }
        const calculatedDelta = itemAmount + (refundInput.shipping ?? 0) + existingAdjustment;
        const absDelta = Math.abs(delta);
        return absDelta !== calculatedDelta ? absDelta - calculatedDelta : 0;
    }

    private getOrderPayments(ctx: RequestContext, orderId: ID): Promise<Payment[]> {
        return this.connection.getRepository(ctx, Payment).find({
            relations: ['refunds'],
            where: {
                order: { id: orderId } as any,
            },
        });
    }

    private async customFieldsAreEqual(
        ctx: RequestContext,
        orderLine: OrderLine,
        inputCustomFields: { [key: string]: any } | null | undefined,
        existingCustomFields?: { [key: string]: any },
    ): Promise<boolean> {
        const customFieldDefs = this.configService.customFields.OrderLine;
        if (inputCustomFields == null && typeof existingCustomFields === 'object') {
            // A null value for an OrderLine customFields input is the equivalent
            // of every property of an existing customFields object being null
            // or equal to the defaultValue
            for (const def of customFieldDefs) {
                const key = def.name;
                const existingValue = this.coerceValue(def, existingCustomFields);
                if (existingValue != null && (!def.list || existingValue?.length !== 0)) {
                    if (def.defaultValue != null) {
                        if (existingValue !== def.defaultValue) {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
            }
            return true;
        }

        const customFieldRelations = customFieldDefs.filter(d => d.type === 'relation');
        let lineWithCustomFieldRelations: OrderLine | undefined;
        if (customFieldRelations.length) {
            // for relation types, we need to actually query the DB and check if there is an
            // existing entity assigned.
            lineWithCustomFieldRelations = await this.connection
                .getRepository(ctx, OrderLine)
                .findOne({
                    where: { id: orderLine.id },
                    relations: customFieldRelations.map(r => `customFields.${r.name}`),
                })
                .then(result => result ?? undefined);
        }

        for (const def of customFieldDefs) {
            const key = def.name;
            const existingValue = this.coerceValue(def, existingCustomFields);
            if (def.type !== 'relation' && existingValue !== undefined) {
                const valuesMatch =
                    JSON.stringify(inputCustomFields?.[key]) === JSON.stringify(existingValue);
                const undefinedMatchesNull = existingValue === null && inputCustomFields?.[key] === undefined;
                const defaultValueMatch =
                    inputCustomFields?.[key] === undefined && def.defaultValue === existingValue;
                if (!valuesMatch && !undefinedMatchesNull && !defaultValueMatch) {
                    return false;
                }
            } else if (def.type === 'relation') {
                const inputId = getGraphQlInputName(def);
                const inputValue = inputCustomFields?.[inputId];
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const existingRelation = (lineWithCustomFieldRelations!.customFields as any)[key];
                if (inputValue) {
                    const customFieldNotEqual = def.list
                        ? JSON.stringify((inputValue as ID[]).sort()) !==
                          JSON.stringify(
                              existingRelation?.map((relation: VendureEntity) => relation.id).sort(),
                          )
                        : inputValue !== existingRelation?.id;
                    if (customFieldNotEqual) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    /**
     * This function is required because with the MySQL driver, boolean customFields with a default
     * of `false` were being represented as `0`, thus causing the equality check to fail.
     * So if it's a boolean, we'll explicitly coerce the value to a boolean.
     */
    private coerceValue(def: CustomFieldConfig, existingCustomFields: { [p: string]: any } | undefined) {
        const key = def.name;
        return def.type === 'boolean' && typeof existingCustomFields?.[key] === 'number'
            ? !!existingCustomFields?.[key]
            : existingCustomFields?.[key];
    }

    private async getProductVariantOrThrow(
        ctx: RequestContext,
        productVariantId: ID,
        order: Order,
    ): Promise<ProductVariant> {
        const variant = await this.connection.findOneInChannel(
            ctx,
            ProductVariant,
            productVariantId,
            ctx.channelId,
            {
                relations: ['product', 'productVariantPrices', 'taxCategory'],
                loadEagerRelations: false,
                where: { deletedAt: IsNull() },
            },
        );

        if (variant) {
            return await this.productVariantService.applyChannelPriceAndTax(variant, ctx, order);
        } else {
            throw new EntityNotFoundError('ProductVariant', productVariantId);
        }
    }
}
