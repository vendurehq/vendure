import { OnebridgeContentService, OnebridgeCustomsService, OnebridgeInspectionService, OnebridgeOrderSummaryService, OnebridgeRfqService, OnebridgeSpecSheetService } from '../services';
export declare class RfqFieldResolver {
    private rfqService;
    constructor(rfqService: OnebridgeRfqService);
    customer(rfq: any): {
        name: any;
        contact: any;
        locale: any;
        customerId: any;
    };
    requirement(rfq: any): {
        item: any;
        qty: any;
        eta: any;
        memo: any;
    };
    quote(rfq: any, ctx: any): Promise<import("..").RfqQuote | null>;
    sample(rfq: any, ctx: any): Promise<import("..").RfqSample | null>;
    timeline(rfq: any, ctx: any): Promise<import("..").StageEvent[]>;
}
export declare class StageEventFieldResolver {
    title(event: any): any;
    desc(event: any): any;
    time(event: any): any;
}
export declare class OnebridgeContentFieldResolver {
    title(entry: any, locale?: 'ko' | 'zh'): any;
    body(entry: any, locale?: 'ko' | 'zh'): any;
    type(entry: any): any;
    krTitle(entry: any): any;
    cnTitle(entry: any): any;
    en(entry: any): any;
    points(entry: any): any;
}
export declare class ServiceChannelFieldResolver {
    key(item: any): any;
    no(item: any): any;
    kr(item: any): any;
    cn(item: any): any;
    en(item: any): any;
    headline(item: any): any;
    intro(item: any): any;
}
/** 清关记录：C 端字段别名 + 时间轴（admin 列表同用） */
export declare class CustomsRecordFieldResolver {
    private orderSummaryService;
    constructor(orderSummaryService: OnebridgeOrderSummaryService);
    customsDeclaredAt(record: any): any;
    customsClearedAt(record: any): any;
    customsNote(record: any): any;
    customsDocs(record: any): any;
    timeline(record: any, ctx: any): Promise<import("..").StageEvent[]>;
}
export declare class OnebridgeShopResolver {
    private rfqService;
    private contentService;
    private inspectionService;
    private customsService;
    private orderSummaryService;
    private specSheetService;
    constructor(rfqService: OnebridgeRfqService, contentService: OnebridgeContentService, inspectionService: OnebridgeInspectionService, customsService: OnebridgeCustomsService, orderSummaryService: OnebridgeOrderSummaryService, specSheetService: OnebridgeSpecSheetService);
    submitRfq(ctx: any, input: any): Promise<import("..").Rfq>;
    myRfqs(ctx: any, options: any): Promise<{
        items: import("..").Rfq[];
        totalItems: number;
    }>;
    rfq(ctx: any, code: string): Promise<import("..").Rfq>;
    columns(ctx: any, options: any): Promise<import("..").ContentEntry[]>;
    column(ctx: any, slug: string): Promise<import("..").ContentEntry | null>;
    cases(ctx: any, options: any): Promise<import("..").ContentEntry[]>;
    case(ctx: any, slug: string): Promise<import("..").ContentEntry | null>;
    logisticsChannels(ctx: any, options: any): Promise<import("..").ContentEntry[]>;
    logisticsChannel(ctx: any, slug: string): Promise<import("..").ContentEntry | null>;
    siteContent(ctx: any, options: any): Promise<import("..").ContentEntry[]>;
    siteContentBundle(ctx: any, options: any): Promise<import("../services/content.service").SiteContentBundlePayload>;
    serviceChannels(ctx: any): any[];
    specSheets(ctx: any, take?: number): Promise<import("../services/spec-sheet.service").SpecSheetPayload[]>;
    inspectionReports(ctx: any, args: any): Promise<import("..").InspectionReport[]>;
    orderCustoms(ctx: any, orderCode: string): Promise<import("..").CustomsRecord | null>;
    orderTimeline(ctx: any, orderCode: string): Promise<any>;
    orderTracks(ctx: any, orderCode: string): Promise<any>;
    orderSummary(ctx: any, orderCode: string): Promise<any>;
}
