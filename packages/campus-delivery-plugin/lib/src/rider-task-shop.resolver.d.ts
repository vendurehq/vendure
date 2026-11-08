import { ID, RequestContext } from '@vendure/core';
import { R2MarkService } from './r2-mark.service';
import { HallService } from './hall.service';
import { RiderTaskService } from './rider-task.service';
export declare class RiderTaskShopResolver {
    private riderTaskService;
    private r2Mark;
    private hall;
    constructor(riderTaskService: RiderTaskService, r2Mark: R2MarkService, hall: HallService);
    /** 需登录骑手：service 内部 assertApprovedRider，未登录/未批准/信用分不足抛 ForbiddenError。 */
    campusMyTasks(ctx: RequestContext, status?: string): Promise<import("@vendure/core").Order[]>;
    /** 骑手侧顾客联系方式（号码保护）：仅本单骑手可查，返回 display/callable 而非真实号 */
    campusRiderCustomerContact(ctx: RequestContext, orderId: ID): Promise<import("./privacy-number.service").PrivacyContact>;
    /** 需登录：仅下单人本人可查（service 内归属校验） */
    campusOrderRider(ctx: RequestContext, orderId: ID): Promise<{
        realName: any;
        credit: any;
        phone: null;
        location: {
            lat: number;
            lng: number;
        } | null;
        destination: {
            name: string;
            detail: string | null;
            lat: number;
            lng: number;
        } | null;
        distanceMeters: number | null;
        etaMinutes: number | null;
        deliveryStatus: any;
    } | null>;
    /** 交接码：仅本单骑手可查（R1/R2 第二段起送必填），未指派/已送达返回 null */
    campusTaskHandoverCode(ctx: RequestContext, orderId: ID): Promise<string | null>;
    /** 开始配送：接力单（R1/R2）需传交接码，service 内校验。 */
    campusStartTask(ctx: RequestContext, orderId: ID, code?: string): Promise<import("@vendure/core").Order>;
    /** 转单回大厅；已取货必须拍照交接。错误语义：未登录/非本人 ForbiddenError，状态/缺照片 UserInputError。 */
    campusTransferTask(ctx: RequestContext, orderId: ID, photos: string[], note?: string): Promise<import("@vendure/core").Order>;
    campusDeliverTask(ctx: RequestContext, orderId: ID, photos: string[], note?: string): Promise<import("@vendure/core").Order>;
    /** 骑手位置上报（配送中 10s 一次）：本人 + assigned/in_progress 才写，送达/转单由 service 清除。 */
    campusRiderReportLocation(ctx: RequestContext, orderId: ID, lat: number, lng: number): Promise<import("@vendure/core").Order>;
    campusReportException(ctx: RequestContext, orderId: ID, type: string, photos: string[], note?: string): Promise<import("@vendure/core").Order>;
    /** R2 快递单到校确认：本人 + fulfillmentRoute='R2'，service 内校验，违规抛 Forbidden/UserInputError。 */
    campusMarkArrived(ctx: RequestContext, orderId: ID): Promise<{
        leg1Status: string;
    }>;
    /** R5 顾客侧重发交接码：订单归属校验在 service，仅待交接订单可重发（同单 10 分钟限流）。 */
    campusResendHandoverCode(ctx: RequestContext, orderId: ID): Promise<string>;
    /** A3 骑手侧重发交接码：仅本单骑手、已派单未取餐可重发（同单 3 分钟限频）。 */
    campusRiderResendHandoverCode(ctx: RequestContext, orderId: ID): Promise<string>;
    /** 用户催单（plan 2.4）：状态/频率校验在 service，标记 urged=true + urgedAt。 */
    campusUrgeOrder(ctx: RequestContext, orderId: ID): Promise<import("@vendure/core").Order>;
}
