import { RequestContext } from '@vendure/core';

import { Errors } from '../errors';

/**
 * ONE BRIDGE Channel token 配置（plugin init 时注入）。
 * 未配置时按 ctx.channel.token 工作，便于 e2e / 本地默认渠道直接跑通；
 * 配置后（生产）所有 Shop/Admin 写读都强制落在该 Channel，否则 CHANNEL_NOT_RESOLVED。
 */
let configuredChannelToken: string | undefined;

export function setOnebridgeChannelToken(token?: string): void {
    configuredChannelToken = token;
}

export function resolveChannelToken(ctx: RequestContext): string {
    const token = ctx.channel.token;
    if (configuredChannelToken && configuredChannelToken !== token) {
        throw Errors.channelNotResolved(configuredChannelToken, token);
    }
    return token;
}

/** 事件订阅等无显式入参的场景：判断当前 ctx 是否属于 ONE BRIDGE 渠道（未配置 token 时视为是） */
export function isOnebridgeChannel(ctx: RequestContext): boolean {
    return !configuredChannelToken || configuredChannelToken === ctx.channel.token;
}
