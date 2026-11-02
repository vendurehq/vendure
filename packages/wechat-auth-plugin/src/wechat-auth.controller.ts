import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Logger } from '@vendure/core';

import { WECHAT_AUTH_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { WechatAuthPluginOptions } from './types';
import { WechatAuthService } from './wechat-auth.service';

@Controller('wechat-auth')
export class WechatAuthController {
    constructor(
        @Inject(WECHAT_AUTH_PLUGIN_OPTIONS) private options: WechatAuthPluginOptions,
        private wechatAuthService: WechatAuthService,
    ) {}

    /**
     * JS-SDK 签名接口（公开只读）：GET /wechat-auth/jssdk-signature?url=<当前页面URL>
     * 返回 wx.config 所需的 appId/timestamp/nonceStr/signature
     */
    @Get('jssdk-signature')
    async jssdkSignature(@Query('url') url: string, @Res() res: Response) {
        if (!url) {
            res.status(400).json({ error: 'Missing url parameter' });
            return;
        }
        try {
            // 去掉微信会在签名校验时忽略的 hash 部分
            const cleanUrl = url.split('#')[0];
            const signature = await this.wechatAuthService.generateJsapiSignature(cleanUrl);
            res.json(signature);
        } catch (e: any) {
            Logger.error(`JS-SDK signature error: ${String(e.message)}`, loggerCtx);
            res.status(500).json({ error: 'Failed to generate signature' });
        }
    }

    @Get('callback')
    async callback(@Req() req: Request, @Res() res: Response, @Query('code') code: string) {
        if (!code) {
            res.status(400).send('Missing code parameter');
            return;
        }

        try {
            const url =
                `https://api.weixin.qq.com/sns/oauth2/access_token` +
                `?appid=${this.options.appId}&secret=${this.options.appSecret}` +
                `&code=${code}&grant_type=authorization_code`;
            const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
            const data = await response.json() as any;

            if (data.openid) {
                Logger.info(`WeChat OAuth callback received for openid: ${String(data.openid)}`, loggerCtx);
                res.redirect(`/?wechat_code=${code}&openid=${String(data.openid)}`);
            } else {
                Logger.error(`WeChat OAuth callback failed: ${JSON.stringify(data)}`, loggerCtx);
                res.status(400).send('WeChat OAuth failed');
            }
        } catch (e: any) {
            Logger.error(`WeChat OAuth callback error: ${String(e.message)}`, loggerCtx);
            res.status(500).send('Internal error');
        }
    }
}
