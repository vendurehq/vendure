import { Request, Response } from 'express';
import { FeishuEventService } from './feishu.event.service';
/**
 * 飞书开放平台回调（事件订阅）。
 * nginx 需把 /feishu/ 反代到 Vendure（proxy_pass 末尾不要加 /，否则路径被改写）。
 */
export declare class FeishuController {
    private events;
    constructor(events: FeishuEventService);
    event(body: any, req: Request, res: Response): Promise<void>;
}
