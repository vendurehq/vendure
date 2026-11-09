import { ID, RequestContext } from '@vendure/core';
import { DispatchAdminService, ExceptionAction } from './dispatch-admin.service';
export declare class DispatchAdminResolver {
    private dispatchAdmin;
    constructor(dispatchAdmin: DispatchAdminService);
    campusDispatchBoard(ctx: RequestContext): Promise<{
        paused: boolean;
        alerts: import("./dispatch-admin.service").DispatchAlert[];
        hallOrders: import("@vendure/core").Order[];
        activeOrders: import("@vendure/core").Order[];
        ridersOnline: import("./dispatch-admin.service").DispatchRider[];
        handledOrders: import("./dispatch-admin.service").HandedException[];
    }>;
    campusAssignOrder(ctx: RequestContext, orderId: ID, riderCustomerId: ID): Promise<{
        assigned: boolean;
    }>;
    campusBackToHall(ctx: RequestContext, orderId: ID, note?: string): Promise<{
        backToHall: boolean;
    }>;
    /** 异常处置（plan 3.4）：reassign 回大厅 / refund_diff 退差价 / coupon 发补偿券 / refund_all 全额退单 */
    campusHandleException(ctx: RequestContext, orderId: ID, action: ExceptionAction, amount?: number, couponTemplateId?: ID, note?: string): Promise<{
        ok: boolean;
        action: ExceptionAction;
    }>;
    /** A11 受控出口：强制取消（含已送达单），必须带理由并写审计 */
    campusForceCancelOrder(ctx: RequestContext, orderId: ID, reason: string): Promise<boolean>;
}
