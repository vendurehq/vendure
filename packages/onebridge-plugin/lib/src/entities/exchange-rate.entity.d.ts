import { DeepPartial, VendureEntity } from '@vendure/core';
/**
 * 汇率（CT-00/CT-01）：CNY ↔ KRW 双币定价/结算的数据源。
 * 报价与订单金额固定取下单时快照，避免事后波动；本表只留痕每日取数。
 */
export declare class ExchangeRate extends VendureEntity {
    constructor(input?: DeepPartial<ExchangeRate>);
    /** 1 CNY 对应的最小单位金额（分） */
    baseCny: number;
    /** 对应 KRW 金额（最小单位，按 CT-00 precision=2 口径） */
    quoteKrw: number;
    /** 换算比率（KRW / CNY，含精度） */
    rate: number;
    effectiveAt: Date;
    source: string | null;
}
