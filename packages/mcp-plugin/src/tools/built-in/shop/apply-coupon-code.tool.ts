import { Injectable } from '@nestjs/common';
import { isGraphQlErrorResult, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

const applyCouponCodeInput = z.strictObject({
    code: shortText.describe('Coupon code.'),
});

type ApplyCouponCodeInput = z.infer<typeof applyCouponCodeInput>;

@McpTool({
    name: 'apply_coupon_code',
    toolset: 'shop',
    description:
        'Apply a coupon code to the active cart. A valid code can appear in couponCodes without reducing ' +
        'the total. Compare the returned total and discounts with the previous cart before reporting a discount.',
    keywords: [
        'use a promo code',
        'redeem a discount',
        'enter my voucher',
        'apply a discount code',
        'I have a coupon',
        'use my promotional code',
    ],
    permissions: [Permission.Public],
    behavior: 'mutating',
    usesActiveOrder: true,
    inputSchema: applyCouponCodeInput,
})
@Injectable()
export class ApplyCouponCodeTool implements McpToolHandler<ApplyCouponCodeInput> {
    constructor(
        private readonly activeOrder: McpActiveOrderService,
        private readonly orderService: OrderService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ApplyCouponCodeInput) {
        const order = await this.activeOrder.findEditable(ctx);
        if (isGraphQlErrorResult(order)) {
            return this.serializer.orderOrError(order);
        }
        return this.serializer.orderOrError(
            await this.orderService.applyCouponCode(order.ctx, order.id, input.code),
        );
    }
}
