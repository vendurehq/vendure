"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setOnebridgeChannelToken = setOnebridgeChannelToken;
exports.resolveChannelToken = resolveChannelToken;
exports.isOnebridgeChannel = isOnebridgeChannel;
const errors_1 = require("../errors");
/**
 * ONE BRIDGE Channel token 配置（plugin init 时注入）。
 * 未配置时按 ctx.channel.token 工作，便于 e2e / 本地默认渠道直接跑通；
 * 配置后（生产）所有 Shop/Admin 写读都强制落在该 Channel，否则 CHANNEL_NOT_RESOLVED。
 */
let configuredChannelToken;
function setOnebridgeChannelToken(token) {
    configuredChannelToken = token;
}
function resolveChannelToken(ctx) {
    const token = ctx.channel.token;
    if (configuredChannelToken && configuredChannelToken !== token) {
        throw errors_1.Errors.channelNotResolved(configuredChannelToken, token);
    }
    return token;
}
/** 事件订阅等无显式入参的场景：判断当前 ctx 是否属于 ONE BRIDGE 渠道（未配置 token 时视为是） */
function isOnebridgeChannel(ctx) {
    return !configuredChannelToken || configuredChannelToken === ctx.channel.token;
}
//# sourceMappingURL=channel-context.js.map