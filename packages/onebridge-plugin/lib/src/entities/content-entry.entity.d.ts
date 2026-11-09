import { DeepPartial, VendureEntity } from '@vendure/core';
import { ContentType, NeedType } from '../types';
/**
 * 跨境内容条目（CT-03）：承载「专栏 / 案例 / 物流通道 / 全站块」四类可维护内容。
 *
 * 说明：计划书 §6.3/§6.4 允许「案例/专栏文章实体或多语言 ContentItem 扩展」。
 * 这里选择独立实体而非改造 operations-plugin 的 ContentItem，原因是：
 * 1) ContentItem 被既有租户广泛使用，加字段/改语义有回归风险；
 * 2) 本内容模型要求 kr/cn/en 三语字段成对、且按 channelToken 隔离。
 */
export declare class ContentEntry extends VendureEntity {
    constructor(input?: DeepPartial<ContentEntry>);
    channelToken: string;
    contentType: ContentType;
    slug: string;
    /** 前台模块（可为空：全站块不绑定模块） */
    needType: NeedType | null;
    titleKr: string;
    titleCn: string | null;
    titleEn: string | null;
    bodyKr: string | null;
    bodyCn: string | null;
    bodyEn: string | null;
    /** 面向人群（专栏 who / 全站 audience） */
    who: string | null;
    /** 案例结果（案例 t/w/q/a/r 中的 r） */
    caseResult: string | null;
    /** 时效文案（物流通道/交付周期） */
    eta: string | null;
    tag: string | null;
    color: string | null;
    /** 图片 URL 数组 */
    images: string[] | null;
    /** 结构化附加字段（points/channels/agency/steps 等等价内容） */
    payload: Record<string, unknown> | null;
    sort: number;
    published: boolean;
    publishedAt?: Date;
}
