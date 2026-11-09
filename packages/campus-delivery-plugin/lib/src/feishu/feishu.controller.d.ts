import { Request, Response } from 'express';
import { FeishuEventService } from './feishu.event.service';
/**
 * 飞书开放平台回调（事件订阅）。
 * - /feishu/event：运维告警应用（告警广播/店铺指令/工单通知）
 * - /feishu/rider/event：骑手抢单独立应用（只用骑手应用自己的 verifyToken/encryptKey）
 * nginx 需把 /feishu/ 反代到 Vendure（proxy_pass 末尾不要加 /，否则路径被改写）。
 */
export declare class FeishuController {
    private events;
    constructor(events: FeishuEventService);
    event(body: any, req: Request, res: Response): Promise<void>;
    /** 骑手独立应用回调：与运维回调完全隔离，两者加密凭证不同 */
    riderEvent(body: any, req: Request, res: Response): Promise<void>;
}
