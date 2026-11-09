import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

import { FeishuEventService } from './feishu.event.service';

function header(v: string | string[] | undefined): string | undefined {
    return Array.isArray(v) ? v[0] : v;
}

/**
 * 飞书开放平台回调（事件订阅）。
 * - /feishu/event：运维告警应用（告警广播/店铺指令/工单通知）
 * - /feishu/rider/event：骑手抢单独立应用（只用骑手应用自己的 verifyToken/encryptKey）
 * nginx 需把 /feishu/ 反代到 Vendure（proxy_pass 末尾不要加 /，否则路径被改写）。
 */
@Controller('feishu')
export class FeishuController {
    constructor(private events: FeishuEventService) {}

    @Post('event')
    async event(@Body() body: any, @Req() req: Request, @Res() res: Response): Promise<void> {
        const result = await this.events.handle(body, {
            timestamp: header(req.headers['x-lark-request-timestamp']),
            nonce: header(req.headers['x-lark-request-nonce']),
            signature: header(req.headers['x-lark-signature']),
        });
        res.status(result.status).json(result.body);
    }

    /** 骑手独立应用回调：与运维回调完全隔离，两者加密凭证不同 */
    @Post('rider/event')
    async riderEvent(@Body() body: any, @Req() req: Request, @Res() res: Response): Promise<void> {
        const result = await this.events.handle(
            body,
            {
                timestamp: header(req.headers['x-lark-request-timestamp']),
                nonce: header(req.headers['x-lark-request-nonce']),
                signature: header(req.headers['x-lark-signature']),
            },
            'rider',
        );
        res.status(result.status).json(result.body);
    }
}
