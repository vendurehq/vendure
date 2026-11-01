import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

import { FeishuEventService } from './feishu.event.service';

function header(v: string | string[] | undefined): string | undefined {
    return Array.isArray(v) ? v[0] : v;
}

/**
 * 飞书开放平台回调（事件订阅）。
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
}
