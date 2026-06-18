import { Injectable } from '@nestjs/common';
import {
    CreateAddressInput,
    ShippingMethodQuote,
    TestEligibleShippingMethodsInput,
    TestShippingMethodInput,
    TestShippingMethodQuote,
    TestShippingMethodResult,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Instrument } from '../../common/instrument-decorator';
import { grossPriceOf, netPriceOf } from '../../common/tax-utils';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ShippingLine } from '../../entity/shipping-line/shipping-line.entity';
import { ShippingMethod } from '../../entity/shipping-method/shipping-method.entity';
import { ConfigArgService } from '../helpers/config-arg/config-arg.service';
import { OrderCalculator } from '../helpers/order-calculator/order-calculator';
import { ProductPriceApplicator } from '../helpers/product-price-applicator/product-price-applicator';
import { ShippingCalculator } from '../helpers/shipping-calculator/shipping-calculator';
import { TranslatorService } from '../helpers/translator/translator.service';

/**
 * @description
 * This service is responsible for creating temporary mock Orders against which tests can be run, such as
 * testing a ShippingMethod or Promotion.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class OrderTestingService {
    constructor(
        private connection: TransactionalConnection,
        private orderCalculator: OrderCalculator,
        private shippingCalculator: ShippingCalculator,
        private configArgService: ConfigArgService,
        private configService: ConfigService,
        private productPriceApplicator: ProductPriceApplicator,
        private translator: TranslatorService,
    ) {}

    /**
     * @description
     * Runs a given ShippingMethod configuration against a mock Order to test for eligibility and resulting
     * price.
     */
    async testShippingMethod(
        ctx: RequestContext,
        input: TestShippingMethodInput,
    ): Promise<TestShippingMethodResult> {
        const shippingMethod = new ShippingMethod({
            checker: this.configArgService.parseInput('ShippingEligibilityChecker', input.checker),
            calculator: this.configArgService.parseInput('ShippingCalculator', input.calculator),
        });
        const mockOrder = await this.buildMockOrder(ctx, input.shippingAddress, input.lines);
        const eligible = await shippingMethod.test(ctx, mockOrder);
        const result = eligible ? await shippingMethod.apply(ctx, mockOrder) : undefined;
        let quote: TestShippingMethodQuote | undefined;
        if (result) {
            const { price, priceIncludesTax, taxRate, metadata } = result;
            quote = {
                price: priceIncludesTax ? netPriceOf(price, taxRate) : price,
                priceWithTax: priceIncludesTax ? price : grossPriceOf(price, taxRate),
                metadata,
            };
        }
        return {
            eligible,
            quote,
        };
    }

    /**
     * @description
     * Tests all available ShippingMethods against a mock Order and return those which are eligible. This
     * is intended to simulate a call to the `eligibleShippingMethods` query of the Shop API.
     */
    async testEligibleShippingMethods(
        ctx: RequestContext,
        input: TestEligibleShippingMethodsInput,
    ): Promise<ShippingMethodQuote[]> {
        const mockOrder = await this.buildMockOrder(ctx, input.shippingAddress, input.lines);
        const eligibleMethods = await this.shippingCalculator.getEligibleShippingMethods(ctx, mockOrder);
        return eligibleMethods
            .map(result => {
                this.translator.translate(result.method, ctx);
                return result;
            })
            .map(result => {
                const { price, taxRate, priceIncludesTax, metadata } = result.result;
                return {
                    id: result.method.id,
                    price: priceIncludesTax ? netPriceOf(price, taxRate) : price,
                    priceWithTax: priceIncludesTax ? price : grossPriceOf(price, taxRate),
                    name: result.method.name,
                    code: result.method.code,
                    description: result.method.description,
                    metadata: result.result.metadata,
                };
            });
    }

    private async buildMockOrder(
        ctx: RequestContext,
        shippingAddress: CreateAddressInput,
        lines: Array<{ productVariantId: ID; quantity: number }>,
    ): Promise<Order> {
        const { orderItemPriceCalculationStrategy } = this.configService.orderOptions;
        const mockOrder = new Order({
            lines: [],
            surcharges: [],
            modifications: [],
        });
        mockOrder.shippingAddress = shippingAddress;
        for (const line of lines) {
            const productVariant = await this.connection.getEntityOrThrow(
                ctx,
                ProductVariant,
                line.productVariantId,
                { relations: ['taxCategory'] },
            );
            await this.productPriceApplicator.applyChannelPriceAndTax(productVariant, ctx, mockOrder);
            const orderLine = new OrderLine({
                productVariant,
                adjustments: [],
                taxLines: [],
                quantity: line.quantity,
                taxCategory: productVariant.taxCategory,
                taxCategoryId: productVariant.taxCategoryId,
            });
            mockOrder.lines.push(orderLine);

            const { price, priceIncludesTax } = await orderItemPriceCalculationStrategy.calculateUnitPrice(
                ctx,
                productVariant,
                orderLine.customFields || {},
                mockOrder,
                orderLine.quantity,
            );
            const taxRate = productVariant.taxRateApplied;
            orderLine.listPrice = price;
            orderLine.listPriceIncludesTax = priceIncludesTax;
        }
        mockOrder.shippingLines = [
            new ShippingLine({
                listPrice: 0,
                listPriceIncludesTax: ctx.channel.pricesIncludeTax,
                taxLines: [],
                adjustments: [],
            }),
        ];
        await this.orderCalculator.applyPriceAdjustments(ctx, mockOrder, []);
        return mockOrder;
    }
}
