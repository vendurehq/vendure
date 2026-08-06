import { Injectable } from '@nestjs/common';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { getActiveOrder, orderResult } from '../order-helpers';
import { objectSchema, stringProp } from '../schema-helpers';

interface ApplyCouponCodeInput {
    code: string;
}

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
    inputSchema: objectSchema({ code: stringProp('Coupon code.') }),
})
@Injectable()
export class ApplyCouponCodeTool implements McpToolHandler<ApplyCouponCodeInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: ApplyCouponCodeInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return orderResult(undefined);
        return orderResult(await this.orderService.applyCouponCode(ctx, order.id, input.code));
    }
}
