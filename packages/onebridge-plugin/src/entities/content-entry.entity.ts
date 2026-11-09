import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { ContentType, NeedType } from '../types';

/**
 * 跨境内容条目（CT-03）：承载「专栏 / 案例 / 物流通道 / 全站块」四类可维护内容。
 *
 * 说明：计划书 §6.3/§6.4 允许「案例/专栏文章实体或多语言 ContentItem 扩展」。
 * 这里选择独立实体而非改造 operations-plugin 的 ContentItem，原因是：
 * 1) ContentItem 被既有租户广泛使用，加字段/改语义有回归风险；
 * 2) 本内容模型要求 kr/cn/en 三语字段成对、且按 channelToken 隔离。
 */
@Entity('onebridge_content_entry')
@Index(['channelToken', 'contentType', 'slug'], { unique: true })
export class ContentEntry extends VendureEntity {
    constructor(input?: DeepPartial<ContentEntry>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 64 })
    channelToken: string;

    @Column({ type: 'varchar', length: 24 })
    contentType: ContentType;

    @Column({ type: 'varchar', length: 128 })
    slug: string;

    /** 前台模块（可为空：全站块不绑定模块） */
    @Column({ type: 'varchar', length: 16, nullable: true })
    needType: NeedType | null;

    @Column({ type: 'varchar', length: 200 })
    titleKr: string;

    @Column({ type: 'varchar', length: 200, nullable: true })
    titleCn: string | null;

    @Column({ type: 'varchar', length: 200, nullable: true })
    titleEn: string | null;

    @Column({ type: 'text', nullable: true })
    bodyKr: string | null;

    @Column({ type: 'text', nullable: true })
    bodyCn: string | null;

    @Column({ type: 'text', nullable: true })
    bodyEn: string | null;

    /** 面向人群（专栏 who / 全站 audience） */
    @Column({ type: 'varchar', length: 200, nullable: true })
    who: string | null;

    /** 案例结果（案例 t/w/q/a/r 中的 r） */
    @Column({ type: 'varchar', length: 200, nullable: true })
    caseResult: string | null;

    /** 时效文案（物流通道/交付周期） */
    @Column({ type: 'varchar', length: 100, nullable: true })
    eta: string | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    tag: string | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    color: string | null;

    /** 图片 URL 数组 */
    @Column({ type: 'simple-json', nullable: true })
    images: string[] | null;

    /** 结构化附加字段（points/channels/agency/steps 等等价内容） */
    @Column({ type: 'simple-json', nullable: true })
    payload: Record<string, unknown> | null;

    @Column({ type: 'int', default: 0 })
    sort: number;

    @Column({ type: 'boolean', default: false })
    published: boolean;

    @Column({ nullable: true })
    publishedAt?: Date;
}
