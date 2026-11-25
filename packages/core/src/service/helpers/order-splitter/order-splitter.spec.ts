import { describe, expect, it } from 'vitest';

import { ShippingLine } from '../../../entity/shipping-line/shipping-line.entity';
import { createRequestContext } from '../../../testing/order-test-utils';

import { OrderSplitter } from './order-splitter';

describe('OrderSplitter', () => {
    // #2649 — the chosen ShippingOption must be kept on the seller Orders
    it('copies the chosen ShippingOption onto the ShippingLines of seller Orders', async () => {
        const savedShippingLines: ShippingLine[] = [];
        const repository = {
            save: async (entity: any) => {
                if (entity instanceof ShippingLine) {
                    savedShippingLines.push(entity);
                }
                return { ...entity, id: `new-${savedShippingLines.length}` };
            },
            createQueryBuilder: () => ({
                relation: () => ({ of: () => ({ add: async () => undefined }) }),
            }),
        };
        const shippingLine = new ShippingLine({
            id: 'SL1',
            shippingMethodId: 'SM1',
            listPrice: 1500,
            listPriceIncludesTax: false,
            adjustments: [],
            taxLines: [],
            shippingOptionCode: 'next-day',
            shippingOptionName: 'Next day',
        });
        const splitter = new OrderSplitter(
            { getRepository: () => repository } as any,
            {
                orderOptions: {
                    orderSellerStrategy: {
                        splitOrder: () => [
                            {
                                channelId: 2,
                                state: 'ArrangingPayment',
                                lines: [],
                                shippingLines: [shippingLine],
                            },
                        ],
                    },
                    orderCodeStrategy: { generate: () => 'CODE' },
                },
            } as any,
            {
                getDefaultChannel: async () => ({ id: 1 }),
                findOne: async () => ({ id: 2 }),
            } as any,
            { applyPriceAdjustments: async () => undefined } as any,
        );

        await splitter.createSellerOrders(createRequestContext({ pricesIncludeTax: false }), {
            id: 'O1',
            sellerOrders: [],
        } as any);

        expect(savedShippingLines).toHaveLength(1);
        expect(savedShippingLines[0]).toMatchObject({
            shippingMethodId: 'SM1',
            listPrice: 1500,
            shippingOptionCode: 'next-day',
            shippingOptionName: 'Next day',
        });
    });
});
