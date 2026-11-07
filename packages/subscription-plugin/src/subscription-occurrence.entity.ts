import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';
import { Channel, ChannelAware, DeepPartial, VendureEntity } from '@vendure/core';

/** 期次：第 1..N 期。状态机 pending → orderCreated | skipped | cancelled。幂等：subscriptionId×periodNo 唯一。 */
@Entity()
@Index(['subscriptionId', 'periodNo'], { unique: true })
export class SubscriptionOccurrence extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<SubscriptionOccurrence>) {
        super(input);
    }

    @Column({ type: 'int' })
    channelId: number;

    @Column({ type: 'int' })
    subscriptionId: number;

    @Column({ type: 'int' })
    periodNo: number;

    @Column({ type: 'timestamptz' })
    scheduledDate: Date;

    /** 卖家逐期指定内容 [{variantId,quantity}]（可从模板改）。simple-json。 */
    @Column({ type: 'simple-json', nullable: true })
    sellerItemsJson?: Array<{ variantId: string | number; quantity: number }>;

    @Column({ type: 'int', nullable: true })
    generatedOrderId?: number;

    @Column({ type: 'varchar', nullable: true })
    orderCode?: string;

    /** 跳过原因（卖家未指定 / 库存不足）。 */
    @Column({ type: 'varchar', nullable: true })
    skipReason?: string;

    @Column({ type: 'varchar', default: 'pending' })
    status: string;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];
}