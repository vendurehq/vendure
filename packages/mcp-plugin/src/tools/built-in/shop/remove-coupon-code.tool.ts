import { Injectable } from '@nestjs/common';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { getActiveOrder } from '../order-helpers';
import { objectSchema, stringProp } from '../schema-helpers';
import { orderSummary } from '../serializers';

interface RemoveCouponCodeInput {
    code: string;
}

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
    inputSchema: objectSchema({ code: stringProp('Coupon code.') }),
})
@Injectable()
export class RemoveCouponCodeTool implements McpPluginToolHandler<RemoveCouponCodeInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: RemoveCouponCodeInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return { order: null };
        return { order: orderSummary(await this.orderService.removeCouponCode(ctx, order.id, input.code)) };
    }
}
