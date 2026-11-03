import { Controller, Get, Headers, Query, UnauthorizedException } from '@nestjs/common';
import { Channel, ChannelService, Logger, RequestContext } from '@vendure/core';

import { SettlementService } from '../settlement.service';
import { MerchantApiTokenService } from '../merchant-api-token.service';

const IS_PROD = process.env.NODE_ENV === 'production' || process.env.IS_PROD === 'true';

/**
 * 商家对账 / 订单查询 REST API。
 *
 * 鉴权：`Authorization: Bearer <merchant-api token>`。
 * 令牌由服务端签发（见 MerchantApiTokenService），绑定 channelId 与过期时间，
 * 客户端无法伪造；不再接受公开的 Channel token（生产环境）。
 * 开发/测试环境保留 Channel token 兼容，便于本地 e2e；生产禁止。
 */
@Controller('merchant-api')
export class MerchantApiController {
    constructor(
        private channelService: ChannelService,
        private settlementService: SettlementService,
        private tokenService: MerchantApiTokenService,
    ) {}

    private async resolveChannel(authHeader?: string): Promise<Channel> {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Missing or invalid Authorization header');
        }
        const token = authHeader.slice('Bearer '.length).trim();
        if (!token) {
            throw new UnauthorizedException('Missing merchant token');
        }

        // 1. 服务端签发令牌：签名校验通过后按 token 绑定的 channelId 取渠道
        const signed = this.tokenService.verify(token);
        if (signed) {
            const defaultChannel = await this.channelService.getDefaultChannel();
            const ctx = new RequestContext({
                apiType: 'admin',
                channel: defaultChannel as any,
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
            });
            const channel = await this.channelService.findOne(ctx, signed.channelId);
            if (!channel) {
                throw new UnauthorizedException('Merchant channel not found');
            }
            return channel;
        }

        // 2. 历史兼容：Channel token 仅在非生产接受（生产必须改用签发令牌）
        if (!IS_PROD) {
            const channel = await this.channelService.getChannelFromToken(token);
            if (channel) {
                Logger.warn(
                    'merchant-api 使用 Channel token 鉴权（仅开发环境兼容），生产请改用签发令牌',
                    'marketplace-plugin',
                );
                return channel;
            }
        }

        throw new UnauthorizedException('Invalid merchant token');
    }

    private buildCtx(channel: Channel): RequestContext {
        return new RequestContext({
            apiType: 'admin',
            channel: channel as any,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }

    /** 对账单：GET /merchant-api/settlement?from=ISO&to=ISO */
    @Get('settlement')
    async settlement(
        @Headers('authorization') authHeader: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        const channel = await this.resolveChannel(authHeader);
        const fromDate = from ? new Date(from) : undefined;
        const toDate = to ? new Date(to) : undefined;
        const ctx = this.buildCtx(channel);
        const entries = await this.settlementService.exportMerchantSettlement(
            ctx,
            channel.id,
            fromDate,
            toDate,
        );
        const total = entries.reduce((sum, e) => sum + e.totalWithTax, 0);
        return { count: entries.length, totalWithTax: total, entries };
    }

    /** 订单查询：GET /merchant-api/orders?from=ISO&to=ISO */
    @Get('orders')
    async orders(
        @Headers('authorization') authHeader: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        const channel = await this.resolveChannel(authHeader);
        const fromDate = from ? new Date(from) : undefined;
        const toDate = to ? new Date(to) : undefined;
        const ctx = this.buildCtx(channel);
        const orders = await this.settlementService.listMerchantOrders(ctx, channel.id, fromDate, toDate);
        return {
            count: orders.length,
            items: orders.map(o => ({
                orderId: o.id,
                orderCode: o.code,
                state: o.state,
                totalWithTax: o.totalWithTax,
                currencyCode: o.currencyCode,
                orderPlacedAt: o.orderPlacedAt,
            })),
        };
    }
}
