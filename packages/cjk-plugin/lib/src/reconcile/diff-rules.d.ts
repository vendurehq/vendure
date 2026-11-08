export type DiffType = 'D1' | 'D2' | 'D3' | 'D4';
/** D1 判定的「已发货语义」状态：只有这些状态才要求存在发货/配送/核销凭证 */
export declare const D1_SHIPPED_STATES: ReadonlyArray<string>;
/** D3 判定的「已实收」状态：仅这些状态比较实收金额；PaymentAuthorized 等未实收状态不判 */
export declare const D3_SETTLED_STATES: ReadonlyArray<string>;
export interface DiffOrderInput {
    order: {
        id: string;
        totalWithTax: number;
        state: string;
        customFields?: Record<string, any>;
    };
    deliveryRecords: Array<{
        mode: string;
        sourceLocationId: string | null;
        status: string;
    }>;
    ledgerOuts: Array<{
        sourceLocationId: string | null;
        quantity: number;
    }>;
    /** 发货单证据（Vendure fulfillment 记录） */
    hasShipment?: boolean;
    /** 自提核销证据（pickup_redemption.collected = true） */
    pickupCollected?: boolean;
    /** 校园配送实际送达证据（order.customFields.deliveryStatus = 'delivered'） */
    campusDelivered?: boolean;
    /** 实收支付合计（分）：仅 state='Settled' 的 payment */
    paidSettled?: number;
    /** 已结算退款合计（分）：仅 state='Settled' 的 refund.total */
    settledRefunds?: number;
    mirrorDiff: number;
    cancelled?: boolean;
}
/**
 * 四流逐单比对：
 * D1 缺履约凭证：仅「已发货语义」订单（Shipped/PartiallyShipped/Delivered/PartiallyDelivered）判定，
 *    凭证为「发货单 ∪ 自提核销 ∪ 校园配送实际送达」三者都不存在才算差异；
 *    不再依赖从未写入的 delivery_record 表，也不因该表为空而整轮跳过 D1。
 * D2 扣仓不一致：账本 order:out 仓与配送记录 sourceLocationId 必须一致
 * D3 实收不平：仅已实收状态（PaymentSettled/Delivered）判「实收支付 − 已结算退款」是否等于订单应付；
 *    PaymentAuthorized 等未实收状态不判；分账台账（MerchantSettlementLedger）不再混入 D3，另立独立规则。
 * D4 镜像不平：虚拟仓 onHand ≠ Σ 绑定物理仓 onHand（由批次扫描传入）
 */
export declare function diffOrder(input: DiffOrderInput): DiffType[];
