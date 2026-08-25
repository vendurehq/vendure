import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { McpToolSerializerService } from '../serializer.service';

const removeCouponCodeInput = z.strictObject({
    code: z.string().describe('Coupon code.'),
});

type RemoveCouponCodeInput = z.infer<typeof removeCouponCodeInput>;

@McpTool({
    name: 'remove_coupon_code',
    toolset: 'shop',
    description: 'Remove a coupon code from the active cart.',
    keywords: [
        'take off the discount',
        'cancel my promo code',
        'remove the voucher',
        'get rid of the coupon',
        'undo the discount code',
        'clear the applied promo',
    ],
    permissions: [Permission.Public],
    behavior: 'mutating',
    usesActiveOrder: true,
    inputSchema: removeCouponCodeInput,
})
@Injectable()
export class RemoveCouponCodeTool implements McpToolHandler<RemoveCouponCodeInput> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: RemoveCouponCodeInput) {
        const order = await this.activeOrder.findOrThrow(ctx);
        return {
            order: this.serializer.order(await this.orderService.removeCouponCode(ctx, order.id, input.code)),
        };
    }
}
