import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { CurrencyCode } from '../types';

/** RFQ 报价（CT-02 RfqQuote）：一次有效报价，金额按 CT-00 以最小单位整数传输 */
@Entity('onebridge_rfq_quote')
export class RfqQuote extends VendureEntity {
    constructor(input?: DeepPartial<RfqQuote>) {
        super(input);
    }

    /** 一询价一有效报价 */
    @Index({ unique: true })
    @Column({ type: 'int' })
    rfqId: number;

    @Column({ type: 'int' })
    amount: number;

    @Column({ type: 'varchar', length: 4 })
    currency: CurrencyCode;

    /** 可选属性（非 Date | null 联合）：保证 reflect 元数据为 Date，sqljs/postgres 均可推断列类型 */
    @Column({ nullable: true })
    validUntil?: Date;

    @Column({ type: 'text', nullable: true })
    note: string | null;
}
