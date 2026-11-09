import { CustomerService, OrderService, RequestContext, TransactionalConnection } from '@vendure/core';
import { InspectionReport } from '../entities';
import { InspectionResult } from '../types';
import { OnebridgeRfqService } from './rfq.service';
interface CreateInspectionInput {
    orderCode?: string | null;
    rfqCode?: string | null;
    inspector: string;
    inspectedAt?: Date | string | null;
    result: InspectionResult;
    photos?: string[] | null;
    notesKr?: string | null;
    notesCn?: string | null;
    passed?: boolean | null;
}
interface InspectionListOptions {
    skip?: number;
    take?: number;
    orderCode?: string;
    rfqCode?: string;
    result?: InspectionResult;
    published?: boolean;
}
/** 验货报告（CT-07）：Admin 上传/发布，Shop 仅可见已发布且归属本人的单据。 */
export declare class OnebridgeInspectionService {
    private connection;
    private customerService;
    private orderService;
    private rfqService;
    constructor(connection: TransactionalConnection, customerService: CustomerService, orderService: OrderService, rfqService: OnebridgeRfqService);
    create(ctx: RequestContext, input: CreateInspectionInput): Promise<InspectionReport>;
    publish(ctx: RequestContext, id: string | number): Promise<InspectionReport>;
    shopList(ctx: RequestContext, args: {
        orderCode?: string | null;
        rfqCode?: string | null;
    }): Promise<InspectionReport[]>;
    adminList(ctx: RequestContext, options?: InspectionListOptions): Promise<{
        items: InspectionReport[];
        totalItems: number;
    }>;
    private repo;
    private assertOrderOwnership;
}
export {};
