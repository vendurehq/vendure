import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { ContentEntry } from '../entities';
import { ContentType, CONTENT_TYPES, NeedType, NEED_TYPES } from '../types';
import { resolveChannelToken } from './channel-context';

interface ContentListOptions {
    skip?: number;
    take?: number;
    contentType?: ContentType;
    needType?: NeedType;
    published?: boolean;
    keyword?: string;
}

interface SaveContentInput {
    id?: string | number | null;
    contentType: ContentType;
    slug: string;
    needType?: NeedType | null;
    titleKr: string;
    titleCn?: string | null;
    titleEn?: string | null;
    bodyKr?: string | null;
    bodyCn?: string | null;
    bodyEn?: string | null;
    who?: string | null;
    caseResult?: string | null;
    eta?: string | null;
    tag?: string | null;
    color?: string | null;
    images?: string[] | null;
    payload?: Record<string, unknown> | null;
    sort?: number;
    published?: boolean;
}

type SiteSection = 'modules' | 'shared' | 'roles' | 'reviews';

/** site_block 分组口径：payload.section 优先，其次 slug 前缀；未命中只进 blocks */
const SITE_SECTIONS: Array<[string, SiteSection]> = [
    ['modules', 'modules'],
    ['shared', 'shared'],
    ['roles', 'roles'],
    ['reviews', 'reviews'],
    ['module', 'modules'],
    ['role', 'roles'],
    ['review', 'reviews'],
];

export interface SiteContentBundlePayload {
    blocks: ContentEntry[];
    modules: ContentEntry[];
    shared: ContentEntry[];
    roles: ContentEntry[];
    reviews: ContentEntry[];
}

/** 内容实体（CT-03）：标题/正文成对多语；韩文必填，中文可缺省由前端回落。 */
@Injectable()
export class OnebridgeContentService {
    constructor(private connection: TransactionalConnection) {}

    // ===== Shop =====

    async shopList(
        ctx: RequestContext,
        type: ContentType,
        options?: { needType?: NeedType | null; take?: number },
    ): Promise<ContentEntry[]> {
        const channelToken = resolveChannelToken(ctx);
        const where: Record<string, unknown> = { channelToken, contentType: type, published: true };
        if (options?.needType) where.needType = options.needType;
        return this.repo(ctx).find({
            where,
            order: { sort: 'ASC', createdAt: 'ASC' },
            take: Math.min(100, Math.max(1, options?.take ?? 50)),
        });
    }

    /** 单条已发布内容（C 端详情页 P13/P16 用） */
    async shopFindBySlug(ctx: RequestContext, type: ContentType, slug: string): Promise<ContentEntry | null> {
        const channelToken = resolveChannelToken(ctx);
        return this.repo(ctx).findOne({
            where: { channelToken, contentType: type, slug: slug.trim(), published: true },
        });
    }

    /**
     * 聚合视图（可选消费方式）：保留 siteContent 扁平原样，另按分组口径提供 modules/shared/roles/reviews。
     * 数据源、渠道隔离、published 过滤、排序与 take 夹取全部复用 shopList，不新增查询条件。
     */
    async shopBundle(
        ctx: RequestContext,
        options?: { needType?: NeedType | null; take?: number },
    ): Promise<SiteContentBundlePayload> {
        const blocks = await this.shopList(ctx, 'site_block', options);
        const bundle: SiteContentBundlePayload = {
            blocks,
            modules: [],
            shared: [],
            roles: [],
            reviews: [],
        };
        for (const entry of blocks) {
            const section = this.siteSectionOf(entry);
            if (section) bundle[section].push(entry);
        }
        return bundle;
    }

    /** 频道级配置（CT-03 serviceChannels），数据源为 Channel customField 的 struct list */
    serviceChannels(ctx: RequestContext): any[] {
        const configured = (ctx.channel.customFields as any)?.onebridgeServiceChannels;
        if (!Array.isArray(configured)) return [];
        return configured
            .filter((item: any) => NEED_TYPES.includes(item?.needType))
            .map((item: any) => ({
                ...item,
                points: this.parsePoints(item?.pointsJson),
                pointsJson: undefined,
            }));
    }

    // ===== Admin =====

    async adminList(
        ctx: RequestContext,
        options?: ContentListOptions,
    ): Promise<{ items: ContentEntry[]; totalItems: number }> {
        const channelToken = resolveChannelToken(ctx);
        const qb = this.repo(ctx).createQueryBuilder('entry').where('entry.channelToken = :channelToken', {
            channelToken,
        });
        if (options?.contentType) {
            qb.andWhere('entry.contentType = :contentType', { contentType: options.contentType });
        }
        if (options?.needType) qb.andWhere('entry.needType = :needType', { needType: options.needType });
        if (options?.published !== undefined) {
            qb.andWhere('entry.published = :published', { published: options.published });
        }
        if (options?.keyword) {
            qb.andWhere('(entry.slug LIKE :kw OR entry.titleKr LIKE :kw OR entry.titleCn LIKE :kw)', {
                kw: `%${options.keyword.trim()}%`,
            });
        }
        qb.orderBy('entry.contentType', 'ASC')
            .addOrderBy('entry.sort', 'ASC')
            .skip(Math.max(0, options?.skip ?? 0))
            .take(Math.min(100, Math.max(1, options?.take ?? 20)));
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    async save(ctx: RequestContext, input: SaveContentInput): Promise<ContentEntry> {
        const channelToken = resolveChannelToken(ctx);
        this.validate(input);
        const repo = this.repo(ctx);
        let entry: ContentEntry | null = null;
        if (input.id) {
            entry = await repo.findOne({ where: { id: Number(input.id), channelToken } });
            if (!entry) throw new UserInputError(`Content entry ${input.id} not found`);
        } else {
            // 幂等：同一 (channel, type, slug) 视为更新，避免重复种子产生副本
            entry = await repo.findOne({
                where: { channelToken, contentType: input.contentType, slug: input.slug.trim() },
            });
        }
        const target = entry ?? new ContentEntry({ channelToken });
        target.contentType = input.contentType;
        target.slug = input.slug.trim();
        target.needType = input.needType ?? null;
        target.titleKr = input.titleKr.trim();
        target.titleCn = input.titleCn?.trim() || null;
        target.titleEn = input.titleEn?.trim() || null;
        target.bodyKr = input.bodyKr ?? null;
        target.bodyCn = input.bodyCn ?? null;
        target.bodyEn = input.bodyEn ?? null;
        target.who = input.who ?? null;
        target.caseResult = input.caseResult ?? null;
        target.eta = input.eta ?? null;
        target.tag = input.tag ?? null;
        target.color = input.color ?? null;
        target.images = input.images ?? null;
        target.payload = input.payload ?? null;
        target.sort = input.sort ?? 0;
        if (input.published !== undefined) {
            target.published = input.published;
            // 取消发布需把列写回 NULL；可选 Date 属性不接受 null 字面量，这里显式断言
            target.publishedAt = input.published ? target.publishedAt ?? new Date() : (null as unknown as Date);
        }
        return repo.save(target);
    }

    async delete(ctx: RequestContext, id: string | number): Promise<boolean> {
        const channelToken = resolveChannelToken(ctx);
        const repo = this.repo(ctx);
        const entry = await repo.findOne({ where: { id: Number(id), channelToken } });
        if (!entry) return false;
        await repo.remove(entry);
        return true;
    }

    private repo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, ContentEntry);
    }

    private validate(input: SaveContentInput): void {
        if (!CONTENT_TYPES.includes(input.contentType)) {
            throw new UserInputError(`Unknown content type: ${input.contentType}`);
        }
        if (!input.slug?.trim()) throw new UserInputError('slug is required');
        if (!input.titleKr?.trim()) throw new UserInputError('titleKr is required');
        if (input.needType && !NEED_TYPES.includes(input.needType)) {
            throw new UserInputError(`Unknown need type: ${input.needType}`);
        }
    }

    private parsePoints(value: unknown): unknown[] {
        if (typeof value !== 'string' || !value.trim()) return [];
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /** payload.section 优先；否则按 slug 的 `section-` / `section_` 前缀判定 */
    private siteSectionOf(entry: ContentEntry): SiteSection | null {
        const payload = (entry.payload ?? {}) as Record<string, unknown>;
        const section = typeof payload.section === 'string' ? payload.section.trim().toLowerCase() : '';
        if (section) {
            const matched = SITE_SECTIONS.find(([key]) => key === section);
            if (matched) return matched[1];
        }
        const slug = (entry.slug ?? '').toLowerCase();
        const byPrefix = SITE_SECTIONS.find(
            ([key]) => slug.startsWith(`${key}-`) || slug.startsWith(`${key}_`),
        );
        return byPrefix ? byPrefix[1] : null;
    }
}
