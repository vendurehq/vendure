import { DeepPartial, VendureEntity } from '@vendure/core';
import { CurrencyCode } from '../types';
/** RFQ 报价（CT-02 RfqQuote）：一次有效报价，金额按 CT-00 以最小单位整数传输 */
export declare class RfqQuote extends VendureEntity {
    constructor(input?: DeepPartial<RfqQuote>);
    /** 一询价一有效报价 */
    rfqId: number;
    amount: number;
    currency: CurrencyCode;
    /** 可选属性（非 Date | null 联合）：保证 reflect 元数据为 Date，sqljs/postgres 均可推断列类型 */
    validUntil?: Date;
    note: string | null;
}
