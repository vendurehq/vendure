import { Channel, ChannelAware, DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';

export type BindSource = 'click' | 'code';

@Entity()
export class AffiliateRelation extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<AffiliateRelation>) {
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

    /** 顾客一生只绑一次。 */
    @Index({ unique: true })
    @Column({ type: 'int' })
    customerId: number;

    @Column({ type: 'varchar', default: 'click' })
    bindSource: BindSource;

    @Column({ type: 'timestamptz' })
    boundAt: Date;
}