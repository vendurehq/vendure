import { CustomerService, RequestContext, TransactionalConnection } from '@vendure/core';
import { Rfq, RfqQuote, RfqSample, StageEvent } from '../entities';
import { CrossBorderStage, NeedType } from '../types';
interface SubmitRfqInput {
    need: NeedType;
    name: string;
    contact: string;
    item: string;
    qty?: string | null;
    eta?: string | null;
    memo?: string | null;
    locale: 'ko' | 'zh';
    idempotencyKey?: string | null;
}
interface RfqListOptions {
    skip?: number;
    take?: number;
    needType?: NeedType;
    stage?: CrossBorderStage;
    keyword?: string;
}
interface SaveQuoteInput {
    amount: number;
    currency?: 'KRW' | 'CNY';
    validUntil?: Date | string | null;
    note?: string | null;
}
interface SaveSampleInput {
    status: string;
    trackingNo?: string | null;
    confirmedAt?: Date | string | null;
}
export declare class OnebridgeRfqService {
    private connection;
    private customerService;
    constructor(connection: TransactionalConnection, customerService: CustomerService);
    submitRfq(ctx: RequestContext, input: SubmitRfqInput): Promise<Rfq>;
    myRfqs(ctx: RequestContext, options?: RfqListOptions): Promise<{
        items: Rfq[];
        totalItems: number;
    }>;
    findRfqForCustomer(ctx: RequestContext, code: string): Promise<Rfq>;
    adminList(ctx: RequestContext, options?: RfqListOptions): Promise<{
        items: Rfq[];
        totalItems: number;
    }>;
    adminFind(ctx: RequestContext, id?: string | number, code?: string): Promise<Rfq>;
    saveQuote(ctx: RequestContext, rfqId: string | number, input: SaveQuoteInput): Promise<RfqQuote>;
    saveSample(ctx: RequestContext, rfqId: string | number, input: SaveSampleInput): Promise<RfqSample>;
    transitionStage(ctx: RequestContext, rfqId: string | number, target: CrossBorderStage, detail?: {
        title?: string | null;
        desc?: string | null;
        idempotencyKey?: string | null;
    }): Promise<Rfq>;
    loadQuote(ctx: RequestContext, rfqId: number): Promise<RfqQuote | null>;
    loadSample(ctx: RequestContext, rfqId: number): Promise<RfqSample | null>;
    loadTimeline(ctx: RequestContext, rfqCode: string): Promise<StageEvent[]>;
    private rfqRepo;
    private stageEventRepo;
    private nextRfqCode;
    private appendStageEvent;
    private validateSubmitInput;
    private requireCustomerId;
    private currentCustomerId;
}
export {};
