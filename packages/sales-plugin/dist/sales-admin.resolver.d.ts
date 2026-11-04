import { AdministratorService, ID, Order, RequestContext } from '@vendure/core';
import { SalesService, SalesCreateOrderInput, SalesReportResult } from './sales.service';
export declare class SalesAdminResolver {
    private salesService;
    private administratorService;
    constructor(salesService: SalesService, administratorService: AdministratorService);
    /**
     * 校验报表日期范围，避免把 Invalid Date 传进 SQL
     */
    private parseRange;
    /**
     * 销售员判断是否为 manager+（可查全部）
     */
    private isManager;
    mySales(ctx: RequestContext, state?: string, page?: number, pageSize?: number): Promise<Order[]>;
    allSales(ctx: RequestContext, state?: string, staffId?: string, page?: number, pageSize?: number): Promise<Order[]>;
    salesOrder(ctx: RequestContext, id: ID): Promise<Order | null>;
    salesCreateOrder(ctx: RequestContext, input: SalesCreateOrderInput): Promise<Order>;
    modifyOrderLinePrice(ctx: RequestContext, orderLineId: ID, newPrice: number): Promise<Order>;
    cancelSalesOrder(ctx: RequestContext, orderId: ID, reason?: string): Promise<Order>;
    mySalesReport(ctx: RequestContext, start: string, end: string): Promise<SalesReportResult>;
    salesReport(ctx: RequestContext, start: string, end: string, staffId?: string): Promise<SalesReportResult>;
}
