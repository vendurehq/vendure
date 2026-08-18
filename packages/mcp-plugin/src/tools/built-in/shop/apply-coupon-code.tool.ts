import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
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
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ApplyCouponCodeInput) {
        const order = await this.activeOrder.findOrCreate(ctx);
        return this.serializer.orderOrError(
            await this.orderService.applyCouponCode(ctx, order.id, input.code),
        );
    }
}
