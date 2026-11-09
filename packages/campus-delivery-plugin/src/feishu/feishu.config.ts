import { Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';

const loggerCtx = 'Feishu';

/**
 * 群定位：
 * - channel：店铺群，所有指令只作用于绑定的店铺渠道
 * - platform：平台管理群，看板/汇总/异常为跨店铺视角，写操作按单号/店铺参数指定
 * - rider：骑手群，只接收大厅抢单卡片与抢单回调，不继承任何店铺/平台指令权限
 */
export type FeishuChatScope = 'channel' | 'platform' | 'rider';

/** 单个飞书群的授权与渠道绑定（FEISHU_CHAT_MAP 的一项） */
export interface FeishuChatConfig {
    scope: FeishuChatScope;
    /** 店铺群必填：Vendure 渠道 token（canteen-a-token 等）；平台群留空 */
    channel?: string;
    /** 普通指令白名单（帮助/待处理/查单/异常/接单/出餐/今日汇总） */
    operators: string[];
    /** 高危指令白名单（拒单/关店/开店） */
    owners: string[];
}

export interface FeishuSettings {
    enabled: boolean;
    webhook?: string;
    secret?: string;
    appId?: string;
    appSecret?: string;
    verifyToken?: string;
    encryptKey?: string;
    chats: Record<string, FeishuChatConfig>;
    /** 每日汇总时间 HH:mm（UTC+8） */
    digestAt: string;
}

function splitIds(v: string | undefined): string[] {
    return (v ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

/** 解析 FEISHU_CHAT_MAP（坏 JSON 只告警并退回空表，绝不抛错） */
export function parseChatMap(raw: string | undefined): Record<string, FeishuChatConfig> {
    if (!raw || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        const out: Record<string, FeishuChatConfig> = {};
        for (const [chatId, v] of Object.entries(parsed ?? {})) {
            const item = v as any;
            if (!item) continue;
            // 平台群只能由 scope='platform' 显式声明；channel='*' 属于历史写法，直接忽略并告警，
            // 避免配置里多打一个字符就静默获得全店写权限。
            if (item.channel === '*') {
                Logger.warn(
                    `FEISHU_CHAT_MAP 群 ${chatId} 使用了已废弃的 channel:'*'，已忽略；平台群请改用 scope:'platform'`,
                    loggerCtx,
                );
                continue;
            }
            const platform = item.scope === 'platform';
            const rider = item.scope === 'rider';
            const channel = typeof item.channel === 'string' ? item.channel : undefined;
            // 骑手群不需要渠道绑定；其余群必须显式 platform 或 channel
            if (!platform && !rider && !channel) continue;
            out[chatId] = {
                scope: rider ? 'rider' : platform ? 'platform' : 'channel',
                channel: rider ? undefined : channel,
                operators: Array.isArray(item.operators)
                    ? item.operators.map(String)
                    : splitIds(item.operators),
                owners: Array.isArray(item.owners) ? item.owners.map(String) : splitIds(item.owners),
            };
        }
        return out;
    } catch (e: any) {
        Logger.error(`FEISHU_CHAT_MAP 解析失败，指令功能将不可用：${e?.message}`, loggerCtx);
        return {};
    }
}

export function readFeishuSettings(env: NodeJS.ProcessEnv = process.env): FeishuSettings {
    const enabled = String(env.FEISHU_ENABLED ?? '').toLowerCase() === 'true'
        || String(env.FEISHU_ENABLED ?? '') === '1';
    const settings: FeishuSettings = {
        enabled,
        webhook: env.FEISHU_WEBHOOK?.trim() || undefined,
        secret: env.FEISHU_SECRET?.trim() || undefined,
        appId: env.FEISHU_APP_ID?.trim() || undefined,
        appSecret: env.FEISHU_APP_SECRET?.trim() || undefined,
        verifyToken: env.FEISHU_VERIFY_TOKEN?.trim() || undefined,
        encryptKey: env.FEISHU_ENCRYPT_KEY?.trim() || undefined,
        chats: parseChatMap(env.FEISHU_CHAT_MAP),
        digestAt: /^\d{2}:\d{2}$/.test(env.FEISHU_DIGEST_AT ?? '') ? String(env.FEISHU_DIGEST_AT) : '08:30',
    };
    if (!enabled) return settings;

    const hasSend = !!(settings.webhook || (settings.appId && settings.appSecret));
    const hasReceive = !!(settings.appId && settings.appSecret && settings.verifyToken);
    if (!hasSend && !hasReceive) {
        Logger.error(
            'FEISHU_ENABLED=true 但未配置发送通道（FEISHU_WEBHOOK 或 FEISHU_APP_ID/SECRET），飞书功能禁用',
            loggerCtx,
        );
        settings.enabled = false;
    } else if (!hasSend) {
        Logger.warn('飞书接收通道已配置但缺发送通道，推送与回复将不可用', loggerCtx);
    }
    return settings;
}

@Injectable()
export class FeishuConfigService {
    readonly settings: FeishuSettings;

    constructor() {
        this.settings = readFeishuSettings(process.env);
        if (this.settings.enabled) {
            const mode = this.settings.webhook ? 'webhook' : 'app';
            Logger.info(`飞书已启用（${mode}，群数 ${Object.keys(this.settings.chats).length}）`, loggerCtx);
            // 骑手群 chat_id 允许后填：缺失只告警，不影响启动与其他群指令
            if (!this.riderChatIds.length) {
                Logger.warn(
                    '未配置骑手群（FEISHU_CHAT_MAP 中 scope:"rider"），大厅新单将不会推送飞书抢单卡片',
                    loggerCtx,
                );
            }
        }
    }

    get enabled(): boolean {
        return this.settings.enabled;
    }

    /** 骑手群 chat_id 列表（scope='rider'）；未配置返回空数组，调用方只告警不抛错 */
    get riderChatIds(): string[] {
        return Object.entries(this.settings.chats)
            .filter(([, v]) => v.scope === 'rider')
            .map(([chatId]) => chatId);
    }

    chatOf(chatId: string): FeishuChatConfig | undefined {
        return this.settings.chats[chatId];
    }
}
