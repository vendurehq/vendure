import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';
import { Channel, ChannelAware, DeepPartial, VendureEntity } from '@vendure/core';

@Entity()
export class Review extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<Review>) {
        super(input);
    }

    @Column() customerId: number;

    @Column() productId: number;

    @Column({ type: 'int', nullable: true }) orderLineId: number | null;

    @Column({ type: 'int', nullable: true }) variantId: number | null;

    @Column({ type: 'int' }) rating: number;

    @Column({ type: 'text' }) content: string;

    @Column({ type: 'simple-json', nullable: true }) images: string[] | null;

    @Column({ type: 'simple-json', nullable: true }) videos: string[] | null;

    @Column({ type: 'simple-json', nullable: true }) tags: string[] | null;

    @Column({ default: false }) isAnonymous: boolean;

    @Column({ type: 'varchar', default: 'pending' }) status: string;

    @Column({ type: 'text', nullable: true }) reply: string | null;

    @Column({ nullable: true }) repliedAt?: Date;

    @Column({ default: 0 }) helpfulCount: number;

    @Column({ type: 'int' }) channelId: number;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];

    /** 自关联：追评。parentId 为主评 id，NULL 表示主评。聚合只统计 parentId==NULL 的主评。 */
    @Column({ type: 'int', nullable: true })
    parentId: number | null;

    /** 评价有礼：主评审核通过时已发放奖励（券/积分任一），幂等闸。 */
    @Column({ default: false })
    giftGranted: boolean;

    /**
     * 好评有礼所选礼包：quality（质量）/ service（服务）/ time（时间）。
     * null = 未选礼包（≤3 星或追评）。列由 campus-delivery-plugin 的 p40 迁移补齐。
     */
    @Column({ type: 'varchar', nullable: true })
    giftChoice: string | null;

    /** 审核时间（approve/reject 留痕）；追评窗口以此为基准。 */
    @Column({ type: 'timestamp', nullable: true })
    reviewedAt?: Date | null;

    // ---------------- 差评申诉（P0-4）----------------
    // 列由 campus-delivery-plugin 的 p8-p0-privacy-food-safety 迁移补齐（iframe 环境 synchronize:false）。

    /** null=未申诉；pending=待审核；approved=申诉成立（评价被隐藏）；rejected=申诉驳回 */
    @Column({ type: 'varchar', nullable: true })
    appealStatus: string | null;

    @Column({ type: 'text', nullable: true })
    appealReason: string | null;

    @Column({ type: 'simple-json', nullable: true })
    appealImages: string[] | null;

    @Column({ type: 'timestamptz', nullable: true })
    appealAt: Date | null;

    /** 审核说明（通过/驳回均留痕，同步展示给申诉人） */
    @Column({ type: 'text', nullable: true })
    appealResult: string | null;

    @Column({ type: 'varchar', nullable: true })
    appealReviewedBy: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    appealReviewedAt: Date | null;
}
