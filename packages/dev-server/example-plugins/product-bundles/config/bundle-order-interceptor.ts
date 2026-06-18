import { Order, OrderInterceptor, OrderLine, RequestContext, WillAdjustOrderLineInput } from '@vendure/core';

export class BundleOrderInterceptor implements OrderInterceptor {
    willAdjustOrderLine(ctx: RequestContext, order: Order, input: WillAdjustOrderLineInput) {
        if (input.orderLine.customFields.fromBundle) {
            return 'Cannot adjust bundle items';
        }
        return;
    }

    willRemoveItemFromOrder(ctx: RequestContext, order: Order, orderLine: OrderLine) {
        if (orderLine.customFields.fromBundle) {
            return 'Cannot remove bundle items';
        }
        return;
    }
}
