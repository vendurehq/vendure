import { RequestContext, TransactionalConnection } from '@vendure/core';
import { ContentEntry } from '../entities';
import { ContentType, NeedType } from '../types';
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
/** 内容实体（CT-03）：标题/正文成对多语；韩文必填，中文可缺省由前端回落。 */
export declare class OnebridgeContentService {
    private connection;
    constructor(connection: TransactionalConnection);
    shopList(ctx: RequestContext, type: ContentType, options?: {
        needType?: NeedType | null;
        take?: number;
    }): Promise<ContentEntry[]>;
    /** 单条已发布内容（C 端详情页 P13/P16 用） */
    shopFindBySlug(ctx: RequestContext, type: ContentType, slug: string): Promise<ContentEntry | null>;
    /** 频道级配置（CT-03 serviceChannels），数据源为 Channel customField 的 struct list */
    serviceChannels(ctx: RequestContext): any[];
    adminList(ctx: RequestContext, options?: ContentListOptions): Promise<{
        items: ContentEntry[];
        totalItems: number;
    }>;
    save(ctx: RequestContext, input: SaveContentInput): Promise<ContentEntry>;
    delete(ctx: RequestContext, id: string | number): Promise<boolean>;
    private repo;
    private validate;
    private parsePoints;
}
export {};
