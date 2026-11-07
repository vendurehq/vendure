import { DeepPartial, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class ReconciliationBatch extends VendureEntity {
    constructor(input?: DeepPartial<ReconciliationBatch>) {
        super(input);
    }

    @Index()
    @Column({ type: 'varchar' })
    tenantChannelId: ID;

    @Index()
    @Column({ type: 'varchar' })
    date: string; // YYYY-MM-DD

    @Column({ type: 'varchar', default: 'running' })
    status: string; // running | done

    @Column({ type: 'int', default: 0 })
    d1Count: number;

    @Column({ type: 'int', default: 0 })
    d2Count: number;

    @Column({ type: 'int', default: 0 })
    d3Count: number;

    @Column({ type: 'int', default: 0 })
    d4Count: number;

    @Column({ type: 'int', default: 0 })
    orderTotal: number;

    @Column({ type: 'varchar', default: 'manual' })
    trigger: string; // manual | cron

    @Column({ type: 'timestamptz', nullable: true })
    startedAt?: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    finishedAt?: Date | null;
}

@Entity()
export class ReconciliationOrderLine extends VendureEntity {
    constructor(input?: DeepPartial<ReconciliationOrderLine>) {
        super(input);
    }

    @Index()
    @Column({ type: 'varchar' })
    batchId: ID;

    @Index()
    @Column({ type: 'varchar' })
    orderId: ID;

    @Column({ type: 'text' })
    diffTypes: string; // JSON: DiffType[]

    @Column({ type: 'varchar', default: 'pending' })
    status: string; // pending | closed

    @Column({ type: 'varchar', nullable: true })
    remark?: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    fixedAt?: Date | null;

    @Column({ type: 'varchar', nullable: true })
    fixerId?: string | null;
}
