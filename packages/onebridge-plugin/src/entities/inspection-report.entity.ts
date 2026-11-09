import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { InspectionResult } from '../types';

/** 验货报告（CT-07），编号 QC-YYYYMMDD-NNNN；照片走 OSS URL 列表 */
@Entity('onebridge_inspection_report')
@Index(['orderCode', 'publishedAt'])
export class InspectionReport extends VendureEntity {
    constructor(input?: DeepPartial<InspectionReport>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 32 })
    code: string;

    @Column({ type: 'varchar', length: 32, nullable: true })
    orderCode: string | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    rfqCode: string | null;

    @Column({ type: 'varchar', length: 64 })
    inspector: string;

    @Column()
    inspectedAt: Date;

    @Column({ type: 'varchar', length: 16 })
    result: InspectionResult;

    /** 照片 URL 数组（OSS） */
    @Column({ type: 'simple-json', nullable: true })
    photos: string[] | null;

    @Column({ type: 'text', nullable: true })
    notesKr: string | null;

    @Column({ type: 'text', nullable: true })
    notesCn: string | null;

    /** 是否放行；未通过不放行只由阶段跃迁校验执行，不靠前端隐藏按钮 */
    @Column({ type: 'boolean', default: false })
    passed: boolean;

    /** 发布后 C 端才可见 */
    @Column({ nullable: true })
    publishedAt?: Date;
}
