import { RequestContext } from '@vendure/core';
export declare function setOnebridgeChannelToken(token?: string): void;
export declare function resolveChannelToken(ctx: RequestContext): string;
/** 事件订阅等无显式入参的场景：判断当前 ctx 是否属于 ONE BRIDGE 渠道（未配置 token 时视为是） */
export declare function isOnebridgeChannel(ctx: RequestContext): boolean;
