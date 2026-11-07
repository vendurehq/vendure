import { Channel, ChannelAware, DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';

export type VoucherStatus = 'usable' | 'used' | 'expired' | 'refunded' | 'voided';

@Entity()
export class ServiceVoucher extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<ServiceVoucher>) {
        super(input);
    }

    @Index()
    @Column()
    channelId: number;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];

    /** 关联订单（按件生成，非唯一；幂等由 service existing 检查兜底）。 */
    @Index()
    @Column({ type: 'int' })
    orderId: number;

    @Column({ type: 'int' })
    customerId: number;

    @Column({ type: 'int' })
    shopId: number;

    @Column({ type: 'int' })
    productVariantId: number;

    @Column({ type: 'varchar' })
    productVoucherName: string;

    /** 核销码，唯一防碰撞。 */
    @Index({ unique: true })
    @Column({ type: 'varchar' })
    code: string;

    @Column({ type: 'varchar', default: 'usable' })
    status: VoucherStatus;

    @Column({ type: 'int' })
    effectiveDays: number;

    @Column({ type: 'timestamptz', nullable: true })
    expiresAt?: Date;

    @Column({ type: 'timestamptz', nullable: true })
    usedAt?: Date;

    @Column({ type: 'timestamptz', nullable: true })
    refundedAt?: Date;
}