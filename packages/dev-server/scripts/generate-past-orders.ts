import {
    bootstrapWorker,
    CustomerService,
    isGraphQlErrorResult,
    Logger,
    OrderService,
    ProductVariantService,
    RequestContextService,
    ShippingMethodService,
    TransactionalConnection,
} from '@vendure/core';
import dayjs from 'dayjs';

import { devConfig } from '../dev-config';

const loggerCtx = 'DataSync script';

generatePastOrders()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));

const DAYS_TO_COVER = 30;
const MIN_ORDERS_PER_DAY = 5;
const MAX_ORDERS_PER_DAY = 10;
const MAX_RETRIES = 3;

// This script generates a large number of past Orders over the past <DAYS_TO_COVER> days.
// It is useful for testing scenarios where there are a large number of Orders in the system.
async function generatePastOrders() {
    const { app } = await bootstrapWorker(devConfig);
    const requestContextService = app.get(RequestContextService);
    const orderService = app.get(OrderService);
    const customerService = app.get(CustomerService);
    const productVariantService = app.get(ProductVariantService);
    const shippingMethodService = app.get(ShippingMethodService);
    const connection = app.get(TransactionalConnection);

    const ctx = await requestContextService.create({
        apiType: 'shop',
    });
    const ctxAdmin = await requestContextService.create({
        apiType: 'admin',
    });

    const { items: variants } = await productVariantService.findAll(ctxAdmin, { take: 500 });
    const { items: customers } = await customerService.findAll(ctxAdmin, { take: 500 }, ['user']);

    for (let i = DAYS_TO_COVER; i > 0; i--) {
        const targetDate = dayjs().subtract(DAYS_TO_COVER - i, 'day');
        const numberOfOrders =
            Math.floor(Math.random() * (MAX_ORDERS_PER_DAY - MIN_ORDERS_PER_DAY + 1)) + MIN_ORDERS_PER_DAY;
        Logger.info(`Generating ${numberOfOrders} orders for ${targetDate.format('YYYY-MM-DD')}`);

        let successfulOrders = 0;
        let retryCount = 0;

        while (successfulOrders < numberOfOrders && retryCount < MAX_RETRIES) {
            const customer = getRandomItem(customers);
            if (!customer.user) {
                retryCount++;
                continue;
            }

            try {
                const orderCreated = await connection.withTransaction(ctx, async txCtx => {
                    const order = await orderService.create(txCtx, customer.user!.id);
                    const result = await orderService.addItemToOrder(
                        txCtx,
                        order.id,
                        getRandomItem(variants).id,
                        Math.floor(Math.random() * 3) + 1,
                    );

                    if (isGraphQlErrorResult(result)) {
                        Logger.error(`Failed to add item to order: ${result.message}`);
                        return false;
                    }

                    const eligibleShippingMethods = await orderService.getEligibleShippingMethods(
                        txCtx,
                        order.id,
                    );
                    if (eligibleShippingMethods.length === 0) {
                        Logger.error('No eligible shipping methods found');
                        return false;
                    }

                    await orderService.setShippingMethod(txCtx, order.id, [
                        getRandomItem(eligibleShippingMethods).id,
                    ]);
                    const transitionResult = await orderService.transitionToState(
                        txCtx,
                        order.id,
                        'ArrangingPayment',
                    );

                    if (isGraphQlErrorResult(transitionResult)) {
                        Logger.error(`Failed to transition order state: ${transitionResult.message}`);
                        return false;
                    }

                    const eligiblePaymentMethods = await orderService.getEligiblePaymentMethods(
                        txCtx,
                        order.id,
                    );
                    if (eligiblePaymentMethods.length === 0) {
                        Logger.error('No eligible payment methods found');
                        return false;
                    }

                    const paymentResult = await orderService.addPaymentToOrder(txCtx, order.id, {
                        method: getRandomItem(eligiblePaymentMethods).code,
                        metadata: {},
                    });

                    if (isGraphQlErrorResult(paymentResult)) {
                        Logger.error(`Failed to add payment: ${paymentResult.message}`);
                        return false;
                    }

                    const randomHourOfDay = Math.floor(Math.random() * 24);
                    const placedAt = targetDate.startOf('day').add(randomHourOfDay, 'hour').toDate();

                    await connection.getRepository(txCtx, 'Order').update(order.id, {
                        orderPlacedAt: placedAt,
                    });

                    return true;
                });

                if (orderCreated) {
                    successfulOrders++;
                    retryCount = 0; // Reset retry count on success
                } else {
                    retryCount++;
                }
            } catch (error: unknown) {
                Logger.error(
                    `Error creating order: ${error instanceof Error ? error.message : String(error)}`,
                );
                retryCount++;
            }
        }

        if (successfulOrders < numberOfOrders) {
            Logger.warn(
                `Failed to generate all ${numberOfOrders} orders for ${targetDate.format('YYYY-MM-DD')}. Generated ${successfulOrders} orders.`,
            );
        } else {
            Logger.info(
                `Successfully generated ${successfulOrders} orders for ${targetDate.format('YYYY-MM-DD')}`,
            );
        }
    }
}

// get random item from array
function getRandomItem<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
}
