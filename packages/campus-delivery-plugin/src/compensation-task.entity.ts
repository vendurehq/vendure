import { Column, Entity, Index } from 'typeorm';
import { DeepPartial, VendureEntity } from '@vendure/core';

/**
 * 补偿任务（R2）：券/站内信等旁路动作失败后落库，由定时任务退避重试。
 * 主流程（退款/取消）永远不因补偿失败而回滚；本表只负责「最终一致」。
 */
@Entity()
@Index(['status', 'nextAttemptAt'])
@Index(['dedupeKey'], { unique: true })
export class CampusCompensationTask extends VendureEntity {
    [key: string]: any;
    @Column('int') orderId: number;
    @Column('int') channelId: number;
    @Column({ type: 'int', nullable: true }) customerId: number | null;
    /** coupon=补发补偿券；notify=补发站内信 */
    @Column({ type: 'varchar' }) kind: 'coupon' | 'notify';
    /** 任务参数 JSON（券：templateId/orderCode；通知：event/text） */
    @Column({ type: 'text', nullable: true }) payload: string | null;
    /** 幂等键：同键任务只允许一条（唯一索引） */
    @Column({ type: 'varchar' }) dedupeKey: string;
    @Column({ type: 'varchar', default: 'pending' }) status: 'pending' | 'done' | 'failed';
    @Column({ type: 'int', default: 0 }) attempts: number;
    /** 下次重试时间（退避）；done/failed 后置 null */
    @Column({ type: 'timestamptz', nullable: true }) nextAttemptAt: Date | null;
    @Column({ type: 'varchar', nullable: true }) lastError: string | null;

    constructor(input?: DeepPartial<CampusCompensationTask>) {
        super(input);
    }
}
