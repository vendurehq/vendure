import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';
import { Channel, ChannelAware, DeepPartial, VendureEntity } from '@vendure/core';

/** 周期购实例（买家）：状态机 draft → active → renewalPending → expired | active → cancelled。金额一律「分」。 */
@Entity()
@Index(['channelId', 'customerId'], { unique: false })
export class Subscription extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<Subscription>) {
        super(input);
    }

    @Column({ type: 'int' })
    channelId: number;

    @Column({ type: 'varchar' })
    code: string;

    @Column({ type: 'int' })
    planId: number;

    @Column({ type: 'int' })
    shopId: number;

    @Column({ type: 'int' })
    customerId: number;

    /** 排期日期列表（每个日期一个期次）。simple-json。 */
    @Column({ type: 'simple-json' })
    scheduleJson: string[];

    @Column({ type: 'timestamptz', nullable: true })
    startDate?: Date;

    @Column({ type: 'timestamptz', nullable: true })
    endDate?: Date;

    /** 预存款余额（分）。 */
    @Column({ type: 'int', default: 0 })
    prepaidBalance: number;

    /** 买断总收款（分）。 */
    @Column({ type: 'int', default: 0 })
    purchasedTotal: number;

    /** 买断主订单 id。 */
    @Column({ type: 'int', nullable: true })
    payOrderId?: number;

    @Column({ type: 'varchar', default: 'draft' })
    status: string;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];
}