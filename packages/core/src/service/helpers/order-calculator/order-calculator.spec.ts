import { Test } from '@nestjs/testing';
import { AdjustmentType, LanguageCode, TaxLine } from '@vendure/common/lib/generated-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { beforeAll, describe, expect, it } from 'vitest';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { PromotionItemAction, PromotionOrderAction, PromotionShippingAction } from '../../../config';
import { ensureConfigLoaded } from '../../../config/config-helpers';
import { ConfigService } from '../../../config/config.service';
import { MockConfigService } from '../../../config/config.service.mock';
import { PromotionCondition } from '../../../config/promotion/promotion-condition';
import { DefaultTaxLineCalculationStrategy } from '../../../config/tax/default-tax-line-calculation-strategy';
import { DefaultTaxZoneStrategy } from '../../../config/tax/default-tax-zone-strategy';
import {
    CalculateTaxLinesArgs,
    TaxLineCalculationStrategy,
} from '../../../config/tax/tax-line-calculation-strategy';
import { TransactionalConnection } from '../../../connection';
import { Promotion } from '../../../entity';
import { Order } from '../../../entity/order/order.entity';
import { ShippingLine } from '../../../entity/shipping-line/shipping-line.entity';
import { Surcharge } from '../../../entity/surcharge/surcharge.entity';
import { EventBus } from '../../../event-bus/event-bus';
import {
    createOrder,
    createRequestContext,
    MockTaxRateService,
    taxCategoryReduced,
    taxCategoryStandard,
    taxCategoryZero,
} from '../../../testing/order-test-utils';
import { ShippingMethodService } from '../../services/shipping-method.service';
import { TaxRateService } from '../../services/tax-rate.service';
import { ZoneService } from '../../services/zone.service';
import { ListQueryBuilder } from '../list-query-builder/list-query-builder';
import { ShippingCalculator } from '../shipping-calculator/shipping-calculator';

import { OrderCalculator } from './order-calculator';

const mockShippingMethodId = 'T_1';

describe('OrderCalculator', () => {
    let orderCalculator: OrderCalculator;

    beforeAll(async () => {
        await ensureConfigLoaded();
        const module = await createTestModule();
        orderCalculator = module.get(OrderCalculator);
        const mockConfigService = module.get<ConfigService, MockConfigService>(ConfigService);
        mockConfigService.taxOptions = {
            taxZoneStrategy: new DefaultTaxZoneStrategy(),
            taxLineCalculationStrategy: new DefaultTaxLineCalculationStrategy(),
        };
    });

    describe('taxes', () => {
        it('single line', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 123,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            await orderCalculator.applyPriceAdjustments(ctx, order, []);

            expect(order.subTotal).toBe(123);
            expect(order.subTotalWithTax).toBe(148);
        });

        it('single line, multiple items', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 123,
                        taxCategory: taxCategoryStandard,
                        quantity: 3,
                    },
                ],
            });
            await orderCalculator.applyPriceAdjustments(ctx, order, []);

            expect(order.subTotal).toBe(369);
            expect(order.subTotalWithTax).toBe(443);
        });

        it('resets totals when lines array is empty', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [],
                subTotal: 148,
            });
            await orderCalculator.applyPriceAdjustments(ctx, order, []);

            expect(order.subTotal).toBe(0);
        });
    });

    describe('shipping', () => {
        it('prices exclude tax', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 100,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            order.shippingLines = [
                new ShippingLine({
                    shippingMethodId: mockShippingMethodId,
                }),
            ];
            await orderCalculator.applyPriceAdjustments(ctx, order, []);

            expect(order.subTotal).toBe(100);
            expect(order.shipping).toBe(500);
            expect(order.shippingWithTax).toBe(600);
            expect(order.total).toBe(order.subTotal + 500);
            expect(order.totalWithTax).toBe(order.subTotalWithTax + 600);
            assertOrderTotalsAddUp(order);
        });

        it('prices include tax', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 100,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            order.shippingLines = [
                new ShippingLine({
                    shippingMethodId: mockShippingMethodId,
                }),
            ];
            await orderCalculator.applyPriceAdjustments(ctx, order, []);

            expect(order.subTotal).toBe(83);
            expect(order.shipping).toBe(417);
            expect(order.shippingWithTax).toBe(500);
            expect(order.total).toBe(order.subTotal + 417);
            expect(order.totalWithTax).toBe(order.subTotalWithTax + 500);
            assertOrderTotalsAddUp(order);
        });

        it('multiple shipping lines', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 100,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            order.shippingLines = [
                new ShippingLine({
                    shippingMethodId: mockShippingMethodId,
                }),
                new ShippingLine({
                    shippingMethodId: mockShippingMethodId,
                }),
            ];
            await orderCalculator.applyPriceAdjustments(ctx, order, []);

            expect(order.shippingLines.length).toBe(2);
            expect(order.subTotal).toBe(100);
            expect(order.shipping).toBe(1000);
            expect(order.shippingWithTax).toBe(1200);
            expect(order.total).toBe(order.subTotal + 1000);
            expect(order.totalWithTax).toBe(order.subTotalWithTax + 1200);
            assertOrderTotalsAddUp(order);
        });
    });

    describe('promotions', () => {
        const alwaysTrueCondition = new PromotionCondition({
            args: {},
            code: 'always_true_condition',
            description: [{ languageCode: LanguageCode.en, value: '' }],
            check() {
                return true;
            },
        });

        const orderTotalCondition = new PromotionCondition({
            args: { minimum: { type: 'int' } },
            code: 'order_total_condition',
            description: [{ languageCode: LanguageCode.en, value: '' }],
            check(ctx, order, args) {
                const threshold = ctx.channel.pricesIncludeTax ? order.subTotalWithTax : order.subTotal;
                return args.minimum <= threshold;
            },
        });

        const fixedPriceItemAction = new PromotionItemAction({
            code: 'fixed_price_item_action',
            description: [{ languageCode: LanguageCode.en, value: '' }],
            args: {},
            execute(ctx, item) {
                return -item.unitPrice + 42;
            },
        });

        const fixedPriceOrderAction = new PromotionOrderAction({
            code: 'fixed_price_order_action',
            description: [{ languageCode: LanguageCode.en, value: '' }],
            args: {},
            execute(ctx, order) {
                return (ctx.channel.pricesIncludeTax ? -order.subTotalWithTax : -order.subTotal) + 420;
            },
        });

        const fixedDiscountOrderAction = new PromotionOrderAction({
            code: 'fixed_discount_order_action',
            description: [{ languageCode: LanguageCode.en, value: '' }],
            args: {},
            execute(ctx, order) {
                const discount = -500;
                return discount;
            },
        });

        const percentageItemAction = new PromotionItemAction({
            code: 'percentage_item_action',
            description: [{ languageCode: LanguageCode.en, value: '' }],
            args: { discount: { type: 'int' } },
            async execute(ctx, orderLine, args) {
                const unitPrice = ctx.channel.pricesIncludeTax
                    ? orderLine.unitPriceWithTax
                    : orderLine.unitPrice;
                return -unitPrice * (args.discount / 100);
            },
        });

        const percentageOrderAction = new PromotionOrderAction({
            code: 'percentage_order_action',
            description: [{ languageCode: LanguageCode.en, value: '' }],
            args: { discount: { type: 'int' } },
            execute(ctx, order, args) {
                const orderTotal = ctx.channel.pricesIncludeTax ? order.subTotalWithTax : order.subTotal;
                return -orderTotal * (args.discount / 100);
            },
        });

        const freeShippingAction = new PromotionShippingAction({
            code: 'free_shipping',
            description: [{ languageCode: LanguageCode.en, value: 'Free shipping' }],
            args: {},
            execute(ctx, shippingLine, order, args) {
                return ctx.channel.pricesIncludeTax ? -shippingLine.priceWithTax : -shippingLine.price;
            },
        });

        it('empty string couponCode does not prevent promotion being applied', async () => {
            const hasEmptyStringCouponCode = new Promotion({
                id: 2,
                name: 'Has empty string couponCode',
                couponCode: '',
                conditions: [
                    {
                        code: orderTotalCondition.code,
                        args: [{ name: 'minimum', value: '10' }],
                    },
                ],
                promotionConditions: [orderTotalCondition],
                actions: [
                    {
                        code: percentageOrderAction.code,
                        args: [{ name: 'discount', value: '10' }],
                    },
                ],
                promotionActions: [percentageOrderAction],
            });

            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 100,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            await orderCalculator.applyPriceAdjustments(ctx, order, [hasEmptyStringCouponCode]);

            expect(order.discounts.length).toBe(1);
            expect(order.discounts[0].description).toBe(hasEmptyStringCouponCode.name);
        });

        describe('OrderItem-level discounts', () => {
            describe('percentage items discount', () => {
                const promotion = new Promotion({
                    id: 1,
                    name: '50% off each item',
                    conditions: [{ code: alwaysTrueCondition.code, args: [] }],
                    promotionConditions: [alwaysTrueCondition],
                    actions: [
                        {
                            code: percentageItemAction.code,
                            args: [{ name: 'discount', value: '50' }],
                        },
                    ],
                    promotionActions: [percentageItemAction],
                });

                it('prices exclude tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: false });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 8333,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion], [order.lines[0]]);

                    expect(order.subTotal).toBe(4167);
                    expect(order.subTotalWithTax).toBe(5000);
                    expect(order.lines[0].adjustments.length).toBe(1);
                    expect(order.lines[0].adjustments[0].description).toBe('50% off each item');
                    expect(order.totalWithTax).toBe(5000);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 1400,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                            {
                                listPrice: 650,
                                taxCategory: taxCategoryReduced,
                                quantity: 2,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion], [order.lines[0]]);

                    expect(order.subTotal).toBe(1174);
                    expect(order.subTotalWithTax).toBe(1350);
                    expect(order.lines[0].adjustments.length).toBe(1);
                    expect(order.lines[0].adjustments[0].description).toBe('50% off each item');
                    expect(order.totalWithTax).toBe(1350);
                    assertOrderTotalsAddUp(order);
                });
            });
        });

        describe('Order-level discounts', () => {
            describe('single line with order fixed price action', () => {
                const promotion = new Promotion({
                    id: 1,
                    conditions: [{ code: alwaysTrueCondition.code, args: [] }],
                    promotionConditions: [alwaysTrueCondition],
                    actions: [{ code: fixedPriceOrderAction.code, args: [] }],
                    promotionActions: [fixedPriceOrderAction],
                });

                it('prices exclude tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: false });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 1230,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(420);
                    expect(order.totalWithTax).toBe(504);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 1230,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(350);
                    expect(order.totalWithTax).toBe(420);
                    assertOrderTotalsAddUp(order);
                });
            });

            describe('single line with order fixed discount action', () => {
                const promotion = new Promotion({
                    id: 1,
                    conditions: [{ code: alwaysTrueCondition.code, args: [] }],
                    promotionConditions: [alwaysTrueCondition],
                    actions: [{ code: fixedDiscountOrderAction.code, args: [] }],
                    promotionActions: [fixedDiscountOrderAction],
                });

                it('prices exclude tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: false });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 1230,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(730);
                    expect(order.totalWithTax).toBe(876);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 2000,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                            {
                                listPrice: 1000,
                                taxCategory: taxCategoryReduced,
                                quantity: 2,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.totalWithTax).toBe(3500);
                    assertOrderTotalsAddUp(order);
                });
            });

            describe('condition based on order total', () => {
                const promotion = new Promotion({
                    id: 1,
                    name: 'Test Promotion 1',
                    conditions: [
                        {
                            code: orderTotalCondition.code,
                            args: [{ name: 'minimum', value: '1000' }],
                        },
                    ],
                    promotionConditions: [orderTotalCondition],
                    actions: [{ code: fixedPriceOrderAction.code, args: [] }],
                    promotionActions: [fixedPriceOrderAction],
                });

                it('prices exclude tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: false });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 500,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(500);
                    expect(order.subTotalWithTax).toBe(600);
                    expect(order.discounts.length).toBe(0);

                    // increase the quantity to 2, which will take the total over the minimum set by the
                    // condition.
                    order.lines[0].quantity = 2;

                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion], [order.lines[0]]);

                    expect(order.subTotalWithTax).toBe(504);
                    // Now the fixedPriceOrderAction should be in effect
                    expect(order.discounts.length).toBe(1);
                    expect(order.total).toBe(420);
                    expect(order.totalWithTax).toBe(504);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 500,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(417);
                    expect(order.subTotalWithTax).toBe(500);
                    expect(order.discounts.length).toBe(0);

                    // increase the quantity to 2, which will take the total over the minimum set by the
                    // condition.
                    order.lines[0].quantity = 2;

                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion], [order.lines[0]]);

                    expect(order.subTotalWithTax).toBe(420);
                    // Now the fixedPriceOrderAction should be in effect
                    expect(order.discounts.length).toBe(1);
                    expect(order.total).toBe(350);
                    expect(order.totalWithTax).toBe(420);
                    assertOrderTotalsAddUp(order);
                });
            });

            describe('percentage order discount', () => {
                const promotion = new Promotion({
                    id: 1,
                    name: '50% off order',
                    conditions: [{ code: alwaysTrueCondition.code, args: [] }],
                    promotionConditions: [alwaysTrueCondition],
                    actions: [
                        {
                            code: percentageOrderAction.code,
                            args: [{ name: 'discount', value: '50' }],
                        },
                    ],
                    promotionActions: [percentageOrderAction],
                });

                it('prices exclude tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: false });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 100,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(50);
                    expect(order.discounts.length).toBe(1);
                    expect(order.discounts[0].description).toBe('50% off order');
                    expect(order.totalWithTax).toBe(60);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 100,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(42);
                    expect(order.discounts.length).toBe(1);
                    expect(order.discounts[0].description).toBe('50% off order');
                    expect(order.totalWithTax).toBe(50);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax at 0%', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 100,
                                taxCategory: taxCategoryZero,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(50);
                    expect(order.discounts.length).toBe(1);
                    expect(order.discounts[0].description).toBe('50% off order');
                    expect(order.totalWithTax).toBe(50);
                    assertOrderTotalsAddUp(order);
                });
            });

            it('correct proration', async () => {
                const promotion = new Promotion({
                    id: 1,
                    name: '$5 off order',
                    conditions: [{ code: alwaysTrueCondition.code, args: [] }],
                    promotionConditions: [alwaysTrueCondition],
                    actions: [
                        {
                            code: fixedDiscountOrderAction.code,
                            args: [],
                        },
                    ],
                    promotionActions: [fixedDiscountOrderAction],
                });

                const ctx = createRequestContext({ pricesIncludeTax: true });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 500,
                            taxCategory: taxCategoryStandard,
                            quantity: 1,
                        },
                        {
                            listPrice: 500,
                            taxCategory: taxCategoryZero,
                            quantity: 1,
                        },
                    ],
                });
                await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                expect(order.subTotalWithTax).toBe(500);
                expect(order.discounts.length).toBe(1);
                expect(order.discounts[0].description).toBe('$5 off order');
                expect(order.lines[0].proratedLinePriceWithTax).toBe(250);
                expect(order.lines[1].proratedLinePriceWithTax).toBe(250);
                expect(order.totalWithTax).toBe(500);
                assertOrderTotalsAddUp(order);
            });
        });

        describe('Shipping-level discounts', () => {
            describe('free_shipping', () => {
                const couponCode = 'FREE_SHIPPING';
                const promotion = new Promotion({
                    id: 1,
                    name: 'Free shipping',
                    couponCode,
                    conditions: [],
                    promotionConditions: [],
                    actions: [
                        {
                            code: freeShippingAction.code,
                            args: [],
                        },
                    ],
                    promotionActions: [freeShippingAction],
                });

                it('prices exclude tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: false });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 100,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    order.shippingLines = [
                        new ShippingLine({
                            shippingMethodId: mockShippingMethodId,
                            adjustments: [],
                        }),
                    ];
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(100);
                    expect(order.discounts.length).toBe(0);
                    expect(order.total).toBe(order.subTotal + 500);
                    assertOrderTotalsAddUp(order);

                    order.couponCodes = [couponCode];
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(100);
                    expect(order.discounts.length).toBe(1);
                    expect(order.discounts[0].description).toBe('Free shipping');
                    expect(order.shipping).toBe(0);
                    expect(order.shippingWithTax).toBe(0);
                    expect(order.total).toBe(order.subTotal);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 100,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    order.shippingLines = [
                        new ShippingLine({
                            shippingMethodId: mockShippingMethodId,
                            adjustments: [],
                        }),
                    ];
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(83);
                    expect(order.discounts.length).toBe(0);
                    expect(order.total).toBe(order.subTotal + 417);
                    assertOrderTotalsAddUp(order);

                    order.couponCodes = [couponCode];
                    await orderCalculator.applyPriceAdjustments(ctx, order, [promotion]);

                    expect(order.subTotal).toBe(83);
                    expect(order.discounts.length).toBe(1);
                    expect(order.discounts[0].description).toBe('Free shipping');
                    expect(order.shipping).toBe(0);
                    expect(order.shippingWithTax).toBe(0);
                    expect(order.total).toBe(order.subTotal);
                    assertOrderTotalsAddUp(order);
                });
            });
        });

        describe('interaction amongst promotion actions', () => {
            const orderQuantityCondition = new PromotionCondition({
                args: { minimum: { type: 'int' } },
                code: 'order_quantity_condition',
                description: [
                    {
                        languageCode: LanguageCode.en,
                        value: 'Passes if any order line has at least the minimum quantity',
                    },
                ],
                check(ctx, _order, args) {
                    for (const line of _order.lines) {
                        if (args.minimum <= line.quantity) {
                            return true;
                        }
                    }
                    return false;
                },
            });

            const buy3Get50pcOffOrder = new Promotion({
                id: 1,
                name: 'Buy 3 Get 50% off order',
                conditions: [
                    {
                        code: orderQuantityCondition.code,
                        args: [{ name: 'minimum', value: '3' }],
                    },
                ],
                promotionConditions: [orderQuantityCondition],
                actions: [
                    {
                        code: percentageOrderAction.code,
                        args: [{ name: 'discount', value: '50' }],
                    },
                ],
                promotionActions: [percentageOrderAction],
            });

            const spend1000Get10pcOffOrder = new Promotion({
                id: 2,
                name: 'Spend $10 Get 10% off order',
                conditions: [
                    {
                        code: orderTotalCondition.code,
                        args: [{ name: 'minimum', value: '1000' }],
                    },
                ],
                promotionConditions: [orderTotalCondition],
                actions: [
                    {
                        code: percentageOrderAction.code,
                        args: [{ name: 'discount', value: '10' }],
                    },
                ],
                promotionActions: [percentageOrderAction],
            });

            it('two order-level percentage discounts, one invalidates the other', async () => {
                const ctx = createRequestContext({ pricesIncludeTax: false });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 500,
                            taxCategory: taxCategoryStandard,
                            quantity: 2,
                        },
                    ],
                });

                // initially the order is $100, so the second promotion applies
                await orderCalculator.applyPriceAdjustments(ctx, order, [
                    buy3Get50pcOffOrder,
                    spend1000Get10pcOffOrder,
                ]);

                expect(order.subTotal).toBe(900);
                expect(order.discounts.length).toBe(1);
                expect(order.discounts[0].description).toBe(spend1000Get10pcOffOrder.name);
                expect(order.totalWithTax).toBe(1080);
                assertOrderTotalsAddUp(order);

                // increase the quantity to 3, which will trigger the first promotion and thus
                // bring the order total below the threshold for the second promotion.
                order.lines[0].quantity = 3;

                await orderCalculator.applyPriceAdjustments(
                    ctx,
                    order,
                    [buy3Get50pcOffOrder, spend1000Get10pcOffOrder],
                    [order.lines[0]],
                );

                expect(order.discounts.length).toBe(1);
                expect(order.subTotal).toBe(750);
                expect(order.discounts[0].description).toBe(buy3Get50pcOffOrder.name);
                expect(order.totalWithTax).toBe(900);
                assertOrderTotalsAddUp(order);
            });

            describe('two order-level percentage discounts at the same time', () => {
                it('prices exclude tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: false });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 800,
                                taxCategory: taxCategoryStandard,
                                quantity: 2,
                            },
                        ],
                    });

                    // initially the order is over $10, so the second promotion applies
                    await orderCalculator.applyPriceAdjustments(ctx, order, [
                        buy3Get50pcOffOrder,
                        spend1000Get10pcOffOrder,
                    ]);

                    expect(order.subTotal).toBe(1440);
                    expect(order.discounts.length).toBe(1);
                    expect(order.discounts[0].description).toBe(spend1000Get10pcOffOrder.name);
                    expect(order.totalWithTax).toBe(1728);
                    assertOrderTotalsAddUp(order);

                    // increase the quantity to 3, which will trigger both promotions
                    order.lines[0].quantity = 3;

                    await orderCalculator.applyPriceAdjustments(
                        ctx,
                        order,
                        [buy3Get50pcOffOrder, spend1000Get10pcOffOrder],
                        [order.lines[0]],
                    );

                    expect(order.subTotal).toBe(1080);
                    expect(order.discounts.length).toBe(2);
                    expect(order.totalWithTax).toBe(1296);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 800,
                                taxCategory: taxCategoryStandard,
                                quantity: 3,
                            },
                        ],
                    });

                    await orderCalculator.applyPriceAdjustments(
                        ctx,
                        order,
                        [buy3Get50pcOffOrder, spend1000Get10pcOffOrder],
                        [order.lines[0]],
                    );

                    expect(order.subTotal).toBe(900);
                    expect(order.discounts.length).toBe(2);
                    expect(order.totalWithTax).toBe(1080);
                    assertOrderTotalsAddUp(order);
                });
            });

            describe('item-level & order-level percentage discounts', () => {
                const orderPromo = new Promotion({
                    id: 1,
                    name: '10% off order',
                    couponCode: 'ORDER10',
                    conditions: [],
                    promotionConditions: [],
                    actions: [
                        {
                            code: percentageOrderAction.code,
                            args: [{ name: 'discount', value: '10' }],
                        },
                    ],
                    promotionActions: [percentageOrderAction],
                });

                const itemPromo = new Promotion({
                    id: 2,
                    name: '10% off item',
                    couponCode: 'ITEM10',
                    conditions: [],
                    promotionConditions: [],
                    actions: [
                        {
                            code: percentageItemAction.code,
                            args: [{ name: 'discount', value: '10' }],
                        },
                    ],
                    promotionActions: [percentageItemAction],
                });

                it('prices exclude tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: false });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 155880,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [orderPromo, itemPromo]);

                    // Apply the item-level discount
                    order.couponCodes.push('ITEM10');
                    await orderCalculator.applyPriceAdjustments(ctx, order, [orderPromo, itemPromo]);
                    expect(order.subTotal).toBe(140292);
                    expect(order.subTotalWithTax).toBe(168350);
                    assertOrderTotalsAddUp(order);

                    // Apply the order-level discount
                    order.couponCodes.push('ORDER10');
                    await orderCalculator.applyPriceAdjustments(ctx, order, [orderPromo, itemPromo]);
                    expect(order.subTotal).toBe(126263);
                    expect(order.subTotalWithTax).toBe(151516);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 155880,
                                taxCategory: taxCategoryStandard,
                                quantity: 1,
                            },
                        ],
                    });
                    await orderCalculator.applyPriceAdjustments(ctx, order, [orderPromo, itemPromo]);

                    // Apply the item-level discount
                    order.couponCodes.push('ITEM10');
                    await orderCalculator.applyPriceAdjustments(ctx, order, [orderPromo, itemPromo]);
                    expect(order.subTotal).toBe(116910);
                    expect(order.subTotalWithTax).toBe(140292);
                    assertOrderTotalsAddUp(order);

                    // Apply the order-level discount
                    order.couponCodes.push('ORDER10');
                    await orderCalculator.applyPriceAdjustments(ctx, order, [orderPromo, itemPromo]);
                    expect(order.subTotal).toBe(105219);
                    expect(order.subTotalWithTax).toBe(126263);
                    assertOrderTotalsAddUp(order);
                });
            });

            // This is the "final boss" of the tests :D
            describe('item-level & order-level mixed discounts with multiple tax rates', () => {
                const fifteenPcOff$10ItemsAction = new PromotionItemAction({
                    code: 'percentage_item_action',
                    description: [{ languageCode: LanguageCode.en, value: '' }],
                    args: { discount: { type: 'int' } },
                    async execute(ctx, orderLine, args) {
                        if (orderLine.listPrice === 1000) {
                            const unitPrice = ctx.channel.pricesIncludeTax
                                ? orderLine.unitPriceWithTax
                                : orderLine.unitPrice;
                            return -unitPrice * (15 / 100);
                        }
                        return 0;
                    },
                });

                const $5OffOrderPromo = new Promotion({
                    id: 2,
                    name: '$5 off order',
                    couponCode: 'PROMO1',
                    conditions: [],
                    promotionConditions: [],
                    actions: [
                        {
                            code: fixedDiscountOrderAction.code,
                            args: [],
                        },
                    ],
                    promotionActions: [fixedDiscountOrderAction],
                });

                const fifteenPcOff$10Items = new Promotion({
                    id: 3,
                    name: '15% off item',
                    couponCode: 'PROMO2',
                    conditions: [],
                    promotionConditions: [],
                    actions: [
                        {
                            code: fifteenPcOff$10ItemsAction.code,
                            args: [],
                        },
                    ],
                    promotionActions: [fifteenPcOff$10ItemsAction],
                });

                it('prices exclude tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: false });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 1000,
                                taxCategory: taxCategoryStandard,
                                quantity: 2,
                            },
                            {
                                listPrice: 3499,
                                taxCategory: taxCategoryReduced,
                                quantity: 1,
                            },
                            {
                                listPrice: 255,
                                taxCategory: taxCategoryReduced,
                                quantity: 4,
                            },
                        ],
                    });
                    order.couponCodes.push('PROMO1', 'PROMO2');
                    await orderCalculator.applyPriceAdjustments(ctx, order, [
                        fifteenPcOff$10Items,
                        $5OffOrderPromo,
                    ]);

                    expect(order.subTotal).toBe(5719);
                    expect(order.subTotalWithTax).toBe(6446);
                    assertOrderTotalsAddUp(order);
                });

                it('prices include tax', async () => {
                    const ctx = createRequestContext({ pricesIncludeTax: true });
                    const order = createOrder({
                        ctx,
                        lines: [
                            {
                                listPrice: 1000,
                                taxCategory: taxCategoryStandard,
                                quantity: 2,
                            },
                            {
                                listPrice: 3499,
                                taxCategory: taxCategoryReduced,
                                quantity: 1,
                            },
                            {
                                listPrice: 255,
                                taxCategory: taxCategoryReduced,
                                quantity: 4,
                            },
                        ],
                    });
                    order.couponCodes.push('PROMO1', 'PROMO2');
                    await orderCalculator.applyPriceAdjustments(ctx, order, [
                        fifteenPcOff$10Items,
                        $5OffOrderPromo,
                    ]);
                    // console.table([
                    //     {
                    //         unitPrice: order.lines[0].unitPrice,
                    //         linePrice: order.lines[0].linePrice,
                    //         linePriceWithTax: order.lines[0].linePriceWithTax,
                    //         discountedLinePrice: order.lines[0].discountedLinePrice,
                    //         discountedLinePriceWithTax: order.lines[0].discountedLinePriceWithTax,
                    //         proratedUnitPriceWithTax: order.lines[0].proratedUnitPriceWithTax,
                    //         proratedLinePriceWithTax: order.lines[0].proratedLinePriceWithTax,
                    //     },
                    //     {
                    //         unitPrice: order.lines[1].unitPrice,
                    //         linePrice: order.lines[1].linePrice,
                    //         linePriceWithTax: order.lines[1].linePriceWithTax,
                    //         discountedLinePrice: order.lines[1].discountedLinePrice,
                    //         discountedLinePriceWithTax: order.lines[1].discountedLinePriceWithTax,
                    //         proratedUnitPriceWithTax: order.lines[1].proratedUnitPriceWithTax,
                    //         proratedLinePriceWithTax: order.lines[1].proratedLinePriceWithTax,
                    //     },
                    //     {
                    //         unitPrice: order.lines[2].unitPrice,
                    //         linePrice: order.lines[2].linePrice,
                    //         linePriceWithTax: order.lines[2].linePriceWithTax,
                    //         discountedLinePrice: order.lines[2].discountedLinePrice,
                    //         discountedLinePriceWithTax: order.lines[2].discountedLinePriceWithTax,
                    //         proratedUnitPriceWithTax: order.lines[2].proratedUnitPriceWithTax,
                    //         proratedLinePriceWithTax: order.lines[2].proratedLinePriceWithTax,
                    //     },
                    // ]);

                    // Note: This combination produces slight discrepancies when using the rounding method
                    // of the DefaultMoneyStrategy - i.e. "round then multiply". When using a strategy
                    // of "multiply then round", we would expect the following:
                    // ```
                    // expect(order.subTotal).toBe(5082);
                    // expect(order.subTotalWithTax).toBe(5719);
                    // assertOrderTotalsAddUp(order);
                    // ```
                    // However, there is always a tradeoff when using integer precision with compounding
                    // fractional multiplication.
                    expect(order.subTotal).toBe(5081);
                    expect(order.subTotalWithTax).toBe(5719);
                });
            });

            it(`clear previous promotion state before testing`, async () => {
                const noLineDiscountsCondition = new PromotionCondition({
                    args: {},
                    code: 'no_other_discounts_condition',
                    description: [{ languageCode: LanguageCode.en, value: '' }],
                    check(_ctx, _order) {
                        const linesToDiscount = _order.lines
                            .filter(line => !line.adjustments.length)
                            .map(line => line.id);
                        return linesToDiscount.length ? { lines: linesToDiscount } : false;
                    },
                });
                const discountMatchedLinesAction = new PromotionItemAction({
                    code: 'discount_matched_lines_action',
                    conditions: [noLineDiscountsCondition],
                    description: [{ languageCode: LanguageCode.en, value: '' }],
                    args: { discount: { type: 'int' } },
                    execute(_ctx, orderLine, args, state) {
                        if (state.no_other_discounts_condition.lines.includes(orderLine.id)) {
                            return -args.discount;
                        }
                        return 0;
                    },
                });

                const discountAllUndiscountedItems = new Promotion({
                    id: 1,
                    name: 'Discount all undiscounted items',
                    conditions: [
                        {
                            code: noLineDiscountsCondition.code,
                            args: [],
                        },
                    ],
                    promotionConditions: [noLineDiscountsCondition],
                    actions: [
                        {
                            code: discountMatchedLinesAction.code,
                            args: [{ name: 'discount', value: '50' }],
                        },
                    ],
                    promotionActions: [discountMatchedLinesAction],
                });

                const ctx = createRequestContext({ pricesIncludeTax: false });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 500,
                            taxCategory: taxCategoryStandard,
                            quantity: 2,
                        },
                    ],
                });

                await orderCalculator.applyPriceAdjustments(ctx, order, [discountAllUndiscountedItems]);
                // everything gets discounted by 50
                expect(order.subTotal).toBe(900);
                // should still be discounted after changing quantity
                order.lines[0].quantity = 3;
                await orderCalculator.applyPriceAdjustments(ctx, order, [discountAllUndiscountedItems]);
                expect(order.subTotal).toBe(1350);
            });
        });
    });

    describe('surcharges', () => {
        describe('positive surcharge without tax', () => {
            it('prices exclude tax', async () => {
                const ctx = createRequestContext({ pricesIncludeTax: false });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 1000,
                            taxCategory: taxCategoryStandard,
                            quantity: 2,
                        },
                        {
                            listPrice: 3499,
                            taxCategory: taxCategoryReduced,
                            quantity: 1,
                        },
                    ],
                });
                order.surcharges = [
                    new Surcharge({
                        description: 'payment surcharge',
                        listPrice: 240,
                        listPriceIncludesTax: false,
                        taxLines: [],
                        sku: 'PSC',
                    }),
                ];

                await orderCalculator.applyPriceAdjustments(ctx, order, []);

                expect(order.subTotal).toBe(5739);
                expect(order.subTotalWithTax).toBe(6489);
                assertOrderTotalsAddUp(order);
            });

            it('prices include tax', async () => {
                const ctx = createRequestContext({ pricesIncludeTax: true });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 1000,
                            taxCategory: taxCategoryStandard,
                            quantity: 2,
                        },
                        {
                            listPrice: 3499,
                            taxCategory: taxCategoryReduced,
                            quantity: 1,
                        },
                    ],
                });
                order.surcharges = [
                    new Surcharge({
                        description: 'payment surcharge',
                        listPrice: 240,
                        listPriceIncludesTax: true,
                        taxLines: [],
                        sku: 'PSC',
                    }),
                ];

                await orderCalculator.applyPriceAdjustments(ctx, order, []);

                expect(order.subTotal).toBe(5088);
                expect(order.subTotalWithTax).toBe(5739);
                assertOrderTotalsAddUp(order);
            });
        });

        describe('positive surcharge with tax', () => {
            it('prices exclude tax', async () => {
                const ctx = createRequestContext({ pricesIncludeTax: false });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 1000,
                            taxCategory: taxCategoryStandard,
                            quantity: 1,
                        },
                    ],
                });
                order.surcharges = [
                    new Surcharge({
                        description: 'payment surcharge',
                        listPrice: 240,
                        listPriceIncludesTax: false,
                        taxLines: [
                            {
                                description: 'standard tax',
                                taxRate: 20,
                            },
                        ],
                        sku: 'PSC',
                    }),
                ];

                await orderCalculator.applyPriceAdjustments(ctx, order, []);

                expect(order.subTotal).toBe(1240);
                expect(order.subTotalWithTax).toBe(1488);
                assertOrderTotalsAddUp(order);
            });

            it('prices include tax', async () => {
                const ctx = createRequestContext({ pricesIncludeTax: true });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 1000,
                            taxCategory: taxCategoryStandard,
                            quantity: 1,
                        },
                    ],
                });
                order.surcharges = [
                    new Surcharge({
                        description: 'payment surcharge',
                        listPrice: 240,
                        listPriceIncludesTax: true,
                        taxLines: [
                            {
                                description: 'standard tax',
                                taxRate: 20,
                            },
                        ],
                        sku: 'PSC',
                    }),
                ];

                await orderCalculator.applyPriceAdjustments(ctx, order, []);

                expect(order.subTotal).toBe(1033);
                expect(order.subTotalWithTax).toBe(1240);
                assertOrderTotalsAddUp(order);
            });
        });

        describe('negative surcharge with tax', () => {
            it('prices exclude tax', async () => {
                const ctx = createRequestContext({ pricesIncludeTax: false });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 1000,
                            taxCategory: taxCategoryStandard,
                            quantity: 1,
                        },
                    ],
                });
                order.surcharges = [
                    new Surcharge({
                        description: 'custom discount',
                        listPrice: -240,
                        listPriceIncludesTax: false,
                        taxLines: [
                            {
                                description: 'standard tax',
                                taxRate: 20,
                            },
                        ],
                        sku: 'PSC',
                    }),
                ];

                await orderCalculator.applyPriceAdjustments(ctx, order, []);

                expect(order.subTotal).toBe(760);
                expect(order.subTotalWithTax).toBe(912);
                assertOrderTotalsAddUp(order);
            });

            it('prices include tax', async () => {
                const ctx = createRequestContext({ pricesIncludeTax: true });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 1000,
                            taxCategory: taxCategoryStandard,
                            quantity: 1,
                        },
                    ],
                });
                order.surcharges = [
                    new Surcharge({
                        description: 'custom discount',
                        listPrice: -240,
                        listPriceIncludesTax: true,
                        taxLines: [
                            {
                                description: 'standard tax',
                                taxRate: 20,
                            },
                        ],
                        sku: 'PSC',
                    }),
                ];

                await orderCalculator.applyPriceAdjustments(ctx, order, []);

                expect(order.subTotal).toBe(633);
                expect(order.subTotalWithTax).toBe(760);
                assertOrderTotalsAddUp(order);
            });

            it('prices exclude tax but surcharge includes tax', async () => {
                const ctx = createRequestContext({ pricesIncludeTax: false });
                const order = createOrder({
                    ctx,
                    lines: [
                        {
                            listPrice: 1000,
                            taxCategory: taxCategoryStandard,
                            quantity: 1,
                        },
                    ],
                });
                order.surcharges = [
                    new Surcharge({
                        description: 'custom discount',
                        listPrice: -240,
                        listPriceIncludesTax: true,
                        taxLines: [
                            {
                                description: 'standard tax',
                                taxRate: 20,
                            },
                        ],
                        sku: 'PSC',
                    }),
                ];

                await orderCalculator.applyPriceAdjustments(ctx, order, []);

                expect(order.subTotal).toBe(800);
                expect(order.subTotalWithTax).toBe(960);
                assertOrderTotalsAddUp(order);
            });
        });
    });
});

describe('OrderCalculator with custom TaxLineCalculationStrategy', () => {
    let orderCalculator: OrderCalculator;
    const newYorkStateTaxLine: TaxLine = {
        description: 'New York state sales tax',
        taxRate: 4,
    };
    const nycCityTaxLine: TaxLine = {
        description: 'NYC sales tax',
        taxRate: 4.5,
    };

    /**
     * This strategy uses a completely custom method of calculation based on the Order
     * shipping address, potentially adding multiple TaxLines. This is intended to simulate
     * tax handling as in the US where multiple tax rates can apply based on location data.
     */
    class CustomTaxLineCalculationStrategy implements TaxLineCalculationStrategy {
        calculate(args: CalculateTaxLinesArgs): Promise<TaxLine[]> {
            const { order } = args;
            const taxLines: TaxLine[] = [];
            if (order.shippingAddress?.province === 'New York') {
                taxLines.push(newYorkStateTaxLine);
                if (order.shippingAddress?.city === 'New York City') {
                    taxLines.push(nycCityTaxLine);
                }
            }

            // Return a promise to simulate having called out to
            // and external tax API
            return Promise.resolve(taxLines);
        }
    }

    beforeAll(async () => {
        const module = await createTestModule();
        orderCalculator = module.get(OrderCalculator);
        const mockConfigService = module.get<ConfigService, MockConfigService>(ConfigService);
        mockConfigService.taxOptions = {
            taxZoneStrategy: new DefaultTaxZoneStrategy(),
            taxLineCalculationStrategy: new CustomTaxLineCalculationStrategy(),
        };
    });

    it('no TaxLines applied', async () => {
        const ctx = createRequestContext({ pricesIncludeTax: false });
        const order = createOrder({
            ctx,
            lines: [
                {
                    listPrice: 1000,
                    taxCategory: taxCategoryStandard,
                    quantity: 2,
                },
                {
                    listPrice: 3499,
                    taxCategory: taxCategoryReduced,
                    quantity: 1,
                },
            ],
        });
        await orderCalculator.applyPriceAdjustments(ctx, order, []);

        expect(order.subTotal).toBe(5499);
        expect(order.subTotalWithTax).toBe(5499);
        expect(order.taxSummary).toEqual([]);
        expect(order.lines[0].taxLines).toEqual([]);
        expect(order.lines[1].taxLines).toEqual([]);
        assertOrderTotalsAddUp(order);
    });

    it('single TaxLines applied', async () => {
        const ctx = createRequestContext({ pricesIncludeTax: false });
        const order = createOrder({
            ctx,
            lines: [
                {
                    listPrice: 1000,
                    taxCategory: taxCategoryStandard,
                    quantity: 2,
                },
                {
                    listPrice: 3499,
                    taxCategory: taxCategoryReduced,
                    quantity: 1,
                },
            ],
        });
        order.shippingAddress = {
            city: 'Rochester',
            province: 'New York',
        };
        await orderCalculator.applyPriceAdjustments(ctx, order, []);

        expect(order.subTotal).toBe(5499);
        expect(order.subTotalWithTax).toBe(5719);
        expect(order.taxSummary).toEqual([
            {
                description: newYorkStateTaxLine.description,
                taxRate: newYorkStateTaxLine.taxRate,
                taxBase: 5499,
                taxTotal: 220,
            },
        ]);
        expect(order.lines[0].taxLines).toEqual([newYorkStateTaxLine]);
        expect(order.lines[1].taxLines).toEqual([newYorkStateTaxLine]);
        assertOrderTotalsAddUp(order);
    });

    it('multiple TaxLines applied', async () => {
        const ctx = createRequestContext({ pricesIncludeTax: false });
        const order = createOrder({
            ctx,
            lines: [
                {
                    listPrice: 1000,
                    taxCategory: taxCategoryStandard,
                    quantity: 2,
                },
                {
                    listPrice: 3499,
                    taxCategory: taxCategoryReduced,
                    quantity: 1,
                },
            ],
        });
        order.shippingAddress = {
            city: 'New York City',
            province: 'New York',
        };
        await orderCalculator.applyPriceAdjustments(ctx, order, []);

        expect(order.subTotal).toBe(5499);
        expect(order.subTotalWithTax).toBe(5966);
        expect(order.taxSummary).toEqual([
            {
                description: newYorkStateTaxLine.description,
                taxRate: newYorkStateTaxLine.taxRate,
                taxBase: 5499,
                taxTotal: 220,
            },
            {
                description: nycCityTaxLine.description,
                taxRate: nycCityTaxLine.taxRate,
                taxBase: 5499,
                taxTotal: 247,
            },
        ]);
        expect(order.lines[0].taxLines).toEqual([newYorkStateTaxLine, nycCityTaxLine]);
        expect(order.lines[1].taxLines).toEqual([newYorkStateTaxLine, nycCityTaxLine]);
        assertOrderTotalsAddUp(order);
    });
});

function createTestModule() {
    return Test.createTestingModule({
        providers: [
            OrderCalculator,
            RequestContextCacheService,
            { provide: TaxRateService, useClass: MockTaxRateService },
            { provide: ShippingCalculator, useValue: { getEligibleShippingMethods: () => [] } },
            {
                provide: ShippingMethodService,
                useValue: {
                    findOne: (ctx: RequestContext) => ({
                        id: mockShippingMethodId,
                        test: () => true,
                        apply() {
                            return {
                                price: 500,
                                priceIncludesTax: ctx.channel.pricesIncludeTax,
                                taxRate: 20,
                            };
                        },
                    }),
                },
            },
            { provide: ListQueryBuilder, useValue: {} },
            { provide: ConfigService, useClass: MockConfigService },
            { provide: EventBus, useValue: { publish: () => ({}) } },
            { provide: ZoneService, useValue: { getAllWithMembers: () => [] } },
            {
                provide: TransactionalConnection,
                useValue: { getRepository: () => ({ save: () => Promise.resolve() }) },
            },
        ],
    }).compile();
}

/**
 * Make sure that the properties which will be displayed to the customer add up in a consistent way.
 */
function assertOrderTotalsAddUp(order: Order) {
    for (const line of order.lines) {
        const pricesIncludeTax = line.listPriceIncludesTax;

        if (pricesIncludeTax) {
            const lineDiscountsAmountWithTaxSum = summate(line.discounts, 'amountWithTax');
            expect(line.linePriceWithTax + lineDiscountsAmountWithTaxSum).toBe(line.proratedLinePriceWithTax);
        } else {
            const lineDiscountsAmountSum = summate(line.discounts, 'amount');
            expect(line.linePrice + lineDiscountsAmountSum).toBe(line.proratedLinePrice);
        }
    }
    const taxableLinePriceSum = summate(order.lines, 'proratedLinePrice');
    const surchargeSum = summate(order.surcharges, 'price');
    expect(order.subTotal).toBe(taxableLinePriceSum + surchargeSum);

    // Make sure the customer-facing totals also add up
    const displayPriceWithTaxSum = summate(order.lines, 'discountedLinePriceWithTax');
    const surchargeWithTaxSum = summate(order.surcharges, 'priceWithTax');
    const orderDiscountsSum = order.discounts
        .filter(d => d.type === AdjustmentType.DISTRIBUTED_ORDER_PROMOTION)
        .reduce((sum, d) => sum + d.amount, 0);
    const orderDiscountsWithTaxSum = order.discounts
        .filter(d => d.type === AdjustmentType.DISTRIBUTED_ORDER_PROMOTION)
        .reduce((sum, d) => sum + d.amountWithTax, 0);

    // The sum of the display prices + order discounts should in theory exactly
    // equal the subTotalWithTax. In practice, there are occasionally 1cent differences
    // cause by rounding errors. This should be tolerable.
    const differenceBetweenSumAndActual = Math.abs(
        displayPriceWithTaxSum + orderDiscountsWithTaxSum + surchargeWithTaxSum - order.subTotalWithTax,
    );
    expect(differenceBetweenSumAndActual).toBeLessThanOrEqual(1);
}
