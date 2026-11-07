import { Channel, ChannelAware, DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';

export type WithdrawalStatus = 'pending' | 'paid' | 'rejected';

@Entity()
export class AffiliateWithdrawal extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<AffiliateWithdrawal>) {
        super(input);
    }

    @Index()
    @Column()
    channelId: number;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];

    @Column({ type: 'int' })
    affiliateId: number;

    /** 提现金额，分。 */
    @Column({ type: 'bigint' })
    amount: number;

    @Column({ type: 'varchar', default: 'pending' })
    status: WithdrawalStatus;

    @Column({ type: 'timestamptz', nullable: true })
    paidAt?: Date | null;

    @Column({ type: 'varchar', nullable: true })
    note?: string | null;
}