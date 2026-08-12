import { Injectable } from '@nestjs/common';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { getActiveOrder } from '../order-helpers';
import { McpToolSerializerService } from '../serializer.service';

const applyCouponCodeInput = z.strictObject({
    code: z.string().describe('Coupon code.'),
});

type ApplyCouponCodeInput = z.infer<typeof applyCouponCodeInput>;

@McpTool({
    name: 'apply_coupon_code',
    toolset: 'shop',
    description: 'Apply a coupon code to the active cart.',
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
    inputSchema: applyCouponCodeInput,
})
@Injectable()
export class ApplyCouponCodeTool implements McpToolHandler<ApplyCouponCodeInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ApplyCouponCodeInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return this.serializer.orderOrError(undefined);
        return this.serializer.orderOrError(
            await this.orderService.applyCouponCode(ctx, order.id, input.code),
        );
    }
}
