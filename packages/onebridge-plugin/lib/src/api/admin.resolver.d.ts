import { OnebridgeContentService, OnebridgeCustomsService, OnebridgeInspectionService, OnebridgeOrderSummaryService, OnebridgeRfqService, OnebridgeSpecSheetService } from '../services';
export declare class OnebridgeAdminResolver {
    private rfqService;
    private contentService;
    private inspectionService;
    private customsService;
    private orderSummaryService;
    private specSheetService;
    constructor(rfqService: OnebridgeRfqService, contentService: OnebridgeContentService, inspectionService: OnebridgeInspectionService, customsService: OnebridgeCustomsService, orderSummaryService: OnebridgeOrderSummaryService, specSheetService: OnebridgeSpecSheetService);
    onebridgeRfqs(ctx: any, options: any): Promise<{
        items: import("..").Rfq[];
        totalItems: number;
    }>;
    onebridgeRfq(ctx: any, args: any): Promise<import("..").Rfq>;
    saveRfqQuote(ctx: any, rfqId: string, input: any): Promise<import("..").RfqQuote>;
    saveRfqSample(ctx: any, rfqId: string, input: any): Promise<import("..").RfqSample>;
    transitionRfqStage(ctx: any, args: any): Promise<import("..").Rfq>;
    onebridgeContentEntries(ctx: any, options: any): Promise<{
        items: import("..").ContentEntry[];
        totalItems: number;
    }>;
    saveOnebridgeContentEntry(ctx: any, input: any): Promise<import("..").ContentEntry>;
    deleteOnebridgeContentEntry(ctx: any, id: string): Promise<boolean>;
    onebridgeInspectionReports(ctx: any, options: any): Promise<{
        items: import("..").InspectionReport[];
        totalItems: number;
    }>;
    createOnebridgeInspectionReport(ctx: any, input: any): Promise<import("..").InspectionReport>;
    publishOnebridgeInspectionReport(ctx: any, id: string): Promise<import("..").InspectionReport>;
    onebridgeCustomsRecord(ctx: any, orderCode: string): Promise<import("..").CustomsRecord | null>;
    onebridgeCustomsRecords(ctx: any, options: any): Promise<{
        items: import("..").CustomsRecord[];
        totalItems: number;
    }>;
    upsertOnebridgeCustomsRecord(ctx: any, input: any): Promise<import("..").CustomsRecord>;
    onebridgeOrderSummary(ctx: any, orderCode: string): Promise<any>;
    onebridgeSpecSheets(ctx: any, take?: number): Promise<import("../services/spec-sheet.service").SpecSheetPayload[]>;
}
