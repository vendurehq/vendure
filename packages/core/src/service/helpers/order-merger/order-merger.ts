import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { RequestContext } from '../../../api/common/request-context';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { MergedOrderLine } from '../../../config/order/order-merge-strategy';
import { Order } from '../../../entity/order/order.entity';
import { OrderLine } from '../../../entity/order-line/order-line.entity';

export type OrderWithNoLines = Order & { lines: undefined };
export type OrderWithEmptyLines = Order & { lines: ArrayLike<OrderLine> & { length: 0 } };
export type EmptyOrder = OrderWithEmptyLines | OrderWithNoLines;
export type MergeResult = {
    order?: Order;
    linesToInsert?: Array<{ productVariantId: ID; quantity: number; customFields?: any }>;
    linesToModify?: Array<{ orderLineId: ID; quantity: number; customFields?: any }>;
    linesToDelete?: Array<{ orderLineId: ID }>;
    orderToDelete?: Order;
};

@Injectable()
export class OrderMerger {
    constructor(private configService: ConfigService) {}

    /**
     * Applies the configured OrderMergeStrategy to the supplied guestOrder and existingOrder. Returns an object
     * containing entities which then need to be persisted to the database by the OrderService methods.
     */
    async merge(ctx: RequestContext, guestOrder?: Order, existingOrder?: Order): Promise<MergeResult> {
        if (guestOrder && !this.orderEmpty(guestOrder) && existingOrder && !this.orderEmpty(existingOrder)) {
            const { mergeStrategy } = this.configService.orderOptions;
            const mergedLines = await mergeStrategy.merge(ctx, guestOrder, existingOrder);
            return {
                order: existingOrder,
                linesToInsert: this.getLinesToInsert(guestOrder, existingOrder, mergedLines),
                linesToModify: this.getLinesToModify(guestOrder, existingOrder, mergedLines),
                linesToDelete: this.getLinesToDelete(guestOrder, existingOrder, mergedLines),
                orderToDelete: guestOrder,
            };
        } else if (
            guestOrder &&
            !this.orderEmpty(guestOrder) &&
            (!existingOrder || (existingOrder && this.orderEmpty(existingOrder)))
        ) {
            return {
                order: guestOrder,
                orderToDelete: existingOrder,
            };
        } else {
            return {
                order: existingOrder,
                orderToDelete: guestOrder,
            };
        }
    }

    private getLinesToInsert(
        guestOrder: Order,
        existingOrder: Order,
        mergedLines: MergedOrderLine[],
    ): Array<{ productVariantId: ID; quantity: number; customFields?: any }> {
        return guestOrder.lines
            .map(guestLine => {
                const mergedLine = mergedLines.find(ml => idsAreEqual(ml.orderLineId, guestLine.id));
                if (!mergedLine) {
                    return;
                }
                return {
                    productVariantId: guestLine.productVariant.id,
                    quantity: mergedLine.quantity,
                    customFields: mergedLine.customFields,
                };
            })
            .filter(notNullOrUndefined);
    }

    private getLinesToModify(
        guestOrder: Order,
        existingOrder: Order,
        mergedLines: MergedOrderLine[],
    ): Array<{ orderLineId: ID; quantity: number; customFields?: any }> {
        return existingOrder.lines
            .map(existingLine => {
                const mergedLine = mergedLines.find(ml => idsAreEqual(ml.orderLineId, existingLine.id));
                if (!mergedLine) {
                    return;
                }
                const lineIsModified =
                    mergedLine.quantity !== existingLine.quantity ||
                    JSON.stringify(mergedLine.customFields) !== JSON.stringify(existingLine.customFields);
                if (!lineIsModified) {
                    return;
                }
                return {
                    orderLineId: mergedLine.orderLineId,
                    quantity: mergedLine.quantity,
                    customFields: mergedLine.customFields,
                };
            })
            .filter(notNullOrUndefined);
    }

    private getLinesToDelete(
        guestOrder: Order,
        existingOrder: Order,
        mergedLines: MergedOrderLine[],
    ): Array<{ orderLineId: ID }> {
        return existingOrder.lines
            .filter(existingLine => !mergedLines.find(ml => idsAreEqual(ml.orderLineId, existingLine.id)))
            .map(existingLine => ({ orderLineId: existingLine.id }));
    }

    private orderEmpty(order: Order | EmptyOrder): order is EmptyOrder {
        return !order || !order.lines || !order.lines.length;
    }
}
