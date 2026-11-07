import { Entity, Index, PrimaryGeneratedColumn, Column } from 'typeorm';

export type ReservationStatus = 'PENDING_ALLOC' | 'ALLOCATED' | 'DONE' | 'RELEASED';

@Entity('stock_reservation')
export class StockReservationEntity {
    @PrimaryGeneratedColumn('increment')
    id!: number;

    @Index()
    @Column()
    orderId!: number;

    @Column({ nullable: true })
    orderLineId!: number;

    @Column()
    variantId!: number;

    @Column({ type: 'int' })
    totalQty!: number; // 下单预占量

    @Column()
    status!: ReservationStatus;

    @Column({ nullable: true })
    tenantChannelId!: string;

    @Column()
    createdAt!: Date;

    /**
     * 预留单到期时间 = 创建时间 + channel customFields.reservationTtlMinutes（默认 30 分钟）。
     * 仅 PENDING_ALLOC 会用到：超时未完成备货拆分 → worker 的 release-expired-reservations 释放。
     * 历史数据为 NULL = 永不过期（不回溯释放旧单）。
     */
    @Index()
    @Column({ type: 'timestamptz', nullable: true })
    expiresAt!: Date | null;
}