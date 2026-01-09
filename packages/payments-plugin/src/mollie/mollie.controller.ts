import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { ChannelService, LanguageCode, Logger, RequestContext, Transaction } from '@vendure/core';
import { Request } from 'express';

import { loggerCtx, PLUGIN_INIT_OPTIONS } from './constants';
import { MollieService } from './mollie.service';
import { MolliePluginOptions } from './mollie.plugin';

@Controller('payments')
export class MollieController {
    constructor(
        private mollieService: MollieService,
        private channelService: ChannelService,
        @Inject(PLUGIN_INIT_OPTIONS) private options: MolliePluginOptions,
    ) { }

    @Post('mollie/:channelToken/:paymentMethodId')
    @Transaction()
    async webhook(
        @Param('channelToken') channelToken: string,
        @Param('paymentMethodId') paymentMethodId: string,
        @Body() body: any,
        @Req() req: Request,
    ): Promise<void> {
        if (this.options.disableWebhookProcessing) {
            return Logger.warn(`Webhook processing is disabled, ignoring incoming webhook '${body.id}'`, loggerCtx);
        }
        if (!body.id) {
            return Logger.warn(' Ignoring incoming webhook, because it has no body.id.', loggerCtx);
        }
        try {
            // We need to construct a RequestContext based on the channelToken,
            // because this is an incoming webhook, not a graphql request with a valid Ctx
            const ctx = await this.createContext(channelToken, req);
            await this.mollieService.handleMolliePaymentStatus(ctx, {
                paymentMethodId,
                paymentId: body.id,
            });
        } catch (error: any) {
            Logger.error(
                `Failed to process incoming webhook: ${JSON.stringify(error?.message)}`,
                loggerCtx,
                error,
            );
            throw error;
        }
    }

    private async createContext(channelToken: string, req: Request): Promise<RequestContext> {
        const channel = await this.channelService.getChannelFromToken(channelToken);
        return new RequestContext({
            apiType: 'admin',
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
            channel,
            // This is a workaround for a type mismatch between express v5 (Vendure core)
            // and express v4 (several transitive dependencies). Can be removed once the
            // ecosystem has more significantly shifted to v5.
            req: req as any,
            languageCode: LanguageCode.en,
        });
    }
}
