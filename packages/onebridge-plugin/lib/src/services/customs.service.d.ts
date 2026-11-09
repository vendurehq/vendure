import { CustomerService, OrderService, RequestContext, TransactionalConnection } from '@vendure/core';
import { CustomsRecord } from '../entities';
import { CustomsStatus } from '../types';
interface UpsertCustomsInput {
    orderCode: string;
    customsStatus?: CustomsStatus;
    declaredAt?: Date | string | null;
    clearedAt?: Date | string | null;
    hsCode?: string | null;
    declarationNo?: string | null;
    note?: string | null;
    docs?: string[] | null;
    idempotencyKey?: string | null;
}
interface CustomsListOptions {
    skip?: number;
    take?: number;
    customsStatus?: CustomsStatus;
    keyword?: string;
}
export declare class OnebridgeCustomsService {
    private connection;
    private orderService;
    private customerService;
    constructor(connection: TransactionalConnection, orderService: OrderService, customerService: CustomerService);
    upsert(ctx: RequestContext, input: UpsertCustomsInput): Promise<CustomsRecord>;
    findByOrderCode(ctx: RequestContext, orderCode: string): Promise<CustomsRecord | null>;
    shopFind(ctx: RequestContext, orderCode: string): Promise<CustomsRecord | null>;
    adminList(ctx: RequestContext, options?: CustomsListOptions): Promise<{
        items: CustomsRecord[];
        totalItems: number;
    }>;
    private repo;
    /** cleared 回写：订单业务阶段 + 时间轴事件（幂等：同一订单只留一条 customs 节点） */
    private onCleared;
    private assertOrderOwnership;
    private asDate;
}
export {};
