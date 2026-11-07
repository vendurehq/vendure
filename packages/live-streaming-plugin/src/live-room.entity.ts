import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';
import { Channel, ChannelAware, DeepPartial, VendureEntity } from '@vendure/core';
import { LiveRoomPlatform } from './live-room-platform.entity';
import { LiveRoomProduct } from './live-room-product.entity';

@Entity()
export class LiveRoom extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<LiveRoom>) {
        super(input);
    }

    /** 直播间标题 */
    @Index()
    @Column()
    name: string;

    /** 封面图 URL */
    @Column({ type: 'varchar', nullable: true })
    coverUrl: string | null;

    /** 简介 */
    @Column({ type: 'text', nullable: true })
    description: string | null;

    /** 主播 customerId（带货主播） */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    streamerCustomerId: string | null;

    /** 主播展示名 */
    @Column({ type: 'varchar', nullable: true })
    streamerName: string | null;

    /** 直播类型：product 带货 / show 展示 */
    @Column({ default: 'product' })
    type: string;

    /** 状态：scheduled 预告 / live 直播中 / ended 已结束 */
    @Column({ default: 'scheduled' })
    status: string;

    /** 计划开始时间 */
    @Column({ type: 'timestamptz', nullable: true })
    scheduledStartAt: Date | null;

    /** 实际开播时间 */
    @Column({ type: 'timestamptz', nullable: true })
    startedAt: Date | null;

    /** 实际结束时间 */
    @Column({ type: 'timestamptz', nullable: true })
    endedAt: Date | null;

    /** 推流 streamKey（腾讯云 push 地址 /live/{streamKey}） */
    @Column({ type: 'varchar', nullable: true })
    streamKey: string | null;

    /** 拉流 HLS 地址 */
    @Column({ type: 'varchar', nullable: true })
    playUrl: string | null;

    /** 回放 HLS 地址 */
    @Column({ type: 'varchar', nullable: true })
    replayUrl: string | null;

    /** 点赞数 */
    @Column({ default: 0 })
    likeCount: number;

    /** 观看人次 */
    @Column({ default: 0 })
    viewCount: number;

    /** 直播间内挂载的商品 */
    @ManyToMany(() => LiveRoomProduct)
    @JoinTable()
    products: LiveRoomProduct[];

    /** 平台分发配置（多租户按渠道过滤） */
    @OneToMany(() => LiveRoomPlatform, p => p.liveRoom)
    platforms: LiveRoomPlatform[];

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];
}
