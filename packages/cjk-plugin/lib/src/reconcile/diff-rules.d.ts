export type DiffType = 'D1' | 'D2' | 'D3' | 'D4';
/** D1 判定的「已发货语义」状态：只有这些状态才要求存在发货/配送/核销凭证 */
export declare const D1_SHIPPED_STATES: ReadonlyArray<string>;
/** D3 判定的「已实收」状态：仅这些状态比较实收金额；PaymentAuthorized 等未实收状态不判 */
export declare const D3_SETTLED_STATES: ReadonlyArray<string>;
/**
 * D1 历史凭证豁免白名单（显式订单 id）。
 * 依据：以下订单在发货单 / 自提核销 / 校园配送送达状态（order.customFields.deliveryStatus）
 * 三项凭证字段启用之前即已完结（state=Delivered），当时三证字段根本不存在，无法补录凭证；
 * 2026-11-08 逐单只读核对确认均为历史单，故按显式 id 豁免 D1，避免与真实缺口混淆。
 * 仅按 id 豁免：不做时间范围/状态等模糊条件；新订单不在本列表，三证皆无仍会正常报 D1。
 */
export declare const D1_HISTORICAL_PROOF_EXEMPT_ORDER_IDS: ReadonlySet<string>;
/** 该单是否属于 D1 历史凭证豁免（字段启用前已完结，三证当时不存在） */
export declare const isD1ProofExempt: (orderId: string | number) => boolean;
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
 * D2 数据源缺失：有扣仓账本，但取不到配送仓（无可用配送记录，或记录 sourceLocationId 为空）。
 * 属取数缺口，不产出差异行；由批次汇总 WARN 体现跳过数量。
 */
export declare const isDeliverySourceMissing: (input: Pick<DiffOrderInput, "deliveryRecords" | "ledgerOuts">) => boolean;
/**
 * 四流逐单比对：
 * D1 缺履约凭证：仅「已发货语义」订单（Shipped/PartiallyShipped/Delivered/PartiallyDelivered）判定，
 *    凭证为「发货单 ∪ 自提核销 ∪ 校园配送实际送达」三者都不存在才算差异；
 *    不再依赖从未写入的 delivery_record 表，也不因该表为空而整轮跳过 D1；
 *    字段启用前已完结的历史单按显式 id 白名单豁免（见 isD1ProofExempt）。
 * D2 扣仓不一致：账本 order:out 仓与配送记录 sourceLocationId 必须一致；
 *    仅「两边都取到仓且不同」才判差异，取不到配送仓属数据源缺失（批次 WARN 统计，不产出差异行）。
 * D3 实收不平：仅已实收状态（PaymentSettled/Delivered）判两类真差异：
 *    ① 实收（Settled 支付合计）≠ 应付 → 少收/多收；② 已结算退款合计 > 实收 → 多退。
 *    合法部分退款、合法全额退款（退款 ≤ 实收）不再报差异；
 *    PaymentAuthorized 等未实收状态不判；分账台账（MerchantSettlementLedger）不再混入 D3，另立独立规则。
 * D4 镜像不平：虚拟仓 onHand ≠ Σ 绑定物理仓 onHand（由批次扫描传入）
 */
export declare function diffOrder(input: DiffOrderInput): DiffType[];
