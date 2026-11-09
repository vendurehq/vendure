import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { CustomsStatus } from '../types';

/**
 * 清关记录（CT-06）：按订单号唯一，补充 logistics-plugin 轨迹实体缺失的清关字段。
 * 不改既有 logistics-track 表，避免影响 e.joho.cn 既有租户。
 */
@Entity('onebridge_customs_record')
export class CustomsRecord extends VendureEntity {
    constructor(input?: DeepPartial<CustomsRecord>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 32 })
    orderCode: string;

    @Column({ type: 'varchar', length: 24, default: 'not_started' })
    customsStatus: CustomsStatus;

    @Column({ nullable: true })
    declaredAt?: Date;

    @Column({ nullable: true })
    clearedAt?: Date;

    @Column({ type: 'varchar', length: 32, nullable: true })
    hsCode: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    declarationNo: string | null;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    /** 清关单证 URL 数组 */
    @Column({ type: 'simple-json', nullable: true })
    docs: string[] | null;

    /** 最后一次同步时间（幂等回写判定依据） */
    @Column({ nullable: true })
    lastSyncedAt?: Date;

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 128, nullable: true })
    idempotencyKey: string | null;
}
