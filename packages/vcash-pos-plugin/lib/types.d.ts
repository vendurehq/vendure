export interface ShiftSummary {
    orders: {
        totalCount: number;
        totalAmount: number;
        normalCount: number;
        refundCount: number;
        refundAmount: number;
        heldCount: number;
    };
    paymentsByMethod: Array<{
        method: string;
        count: number;
        amount: number;
    }>;
    warnings: string[];
}
/** 批量结算结果：成功笔数 + 逐笔失败原因（不再静默吞掉异常） */
export interface SettleSessionAggregatePaysResult {
    settled: number;
    failed: Array<{
        paymentId: string;
        reason: string;
    }>;
}
export interface ReceiptData {
    header: string;
    phone: string;
    address: string;
    footer: string;
    orderCode: string;
    createdAt: string;
    cashier: string;
    lines: Array<{
        name: string;
        qty: number;
        priceUnit: number;
        subtotal: number;
        discount: number;
    }>;
    total: number;
    payments: Array<{
        method: string;
        amount: number;
    }>;
    change: number | null;
}
/**
 * Declaration merging: 把 Order/OrderLine custom fields 声明到 Vendure 内置 class 上，
 * 使 service 层可以强类型访问 customFields.orderType / customFields.originalOrderLineId 等字段。
 */
declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        posSessionId?: number | null;
        orderType?: string | null;
        refundedOrderId?: number | null;
        shiftId?: number | null;
        terminalCode?: string | null;
        aggregatePayStatus?: string | null;
    }
    interface CustomOrderLineFields {
        originalPrice?: number;
        discount?: number;
        memberPriceApplied?: boolean;
        isGift?: boolean;
        note?: string | null;
        originalOrderLineId?: number | null;
    }
}
