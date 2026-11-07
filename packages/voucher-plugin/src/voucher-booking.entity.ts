import { Channel, ChannelAware, DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';

export type BookingStatus = 'booked' | 'visited' | 'noShow' | 'cancelled';

@Entity()
export class VoucherBooking extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<VoucherBooking>) {
        super(input);
    }

    @Index()
    @Column()
    channelId: number;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];

    /** 预约档唯一关联到店券（幂等唯一）。 */
    @Index({ unique: true })
    @Column({ type: 'int' })
    voucherId: number;

    @Column({ type: 'int' })
    customerId: number;

    @Column({ type: 'int' })
    shopId: number;

    @Column({ type: 'timestamptz' })
    slotAt: Date;

    @Column({ type: 'int' })
    customerCount: number;

    @Column({ type: 'varchar', default: 'booked' })
    status: BookingStatus;
}