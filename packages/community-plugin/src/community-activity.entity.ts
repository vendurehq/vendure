import { Channel, ChannelAware, DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';

export type CommunityActivityStatus = 'draft' | 'open' | 'cutover' | 'closed';

@Entity()
export class CommunityActivity extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<CommunityActivity>) {
        super(input);
    }
    @Index()
    @Column()
    channelId: number;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];

    @Column({ type: 'int' })
    leaderId: number;

    @Column({ type: 'int' })
    pickupLocationId: number;

    @Index()
    @Column({ type: 'timestamptz' })
    windowStart: Date;

    @Index()
    @Column({ type: 'timestamptz' })
    windowEnd: Date;

    @Index()
    @Column({ type: 'timestamptz' })
    cutoffTime: Date;

    @Column({ type: 'bigint' }) // 千分比，3% = 3000
    commissionRate: number;

    @Column({ type: 'varchar', default: 'draft' })
    status: CommunityActivityStatus;
}