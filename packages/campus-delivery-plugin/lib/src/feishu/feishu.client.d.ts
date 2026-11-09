import { FeishuConfigService } from './feishu.config';
/**
 * 应用用途：
 * - ops：运维告警应用（群广播、店铺指令、工单通知）
 * - rider：骑手抢单独立应用（抢单卡片、抢单回执）
 * 两者的 appId/appSecret 与 tenant_access_token 均互相隔离，调用时显式选择。
 */
export type FeishuApp = 'ops' | 'rider';
/** 飞书消息体（只取用到的字段） */
export interface FeishuMessage {
    message_id: string;
    msg_type?: string;
    create_time?: string;
    parent_id?: string;
    root_id?: string;
    body?: {
        content?: string;
    };
    thread_id?: string;
}
/** 自定义群机器人签名：base64(hmac_sha256(key = `${timestamp}\n${secret}`, data = '')) */
export declare function buildWebhookSignature(timestamp: string, secret: string): string;
export declare function buildWebhookPayload(text: string, secret?: string, now?: number): Record<string, unknown>;
/**
 * 飞书发送通道：
 * - 群自定义机器人 webhook（只能发，最简单，用于运维群推送）
 * - 自建应用 bot（tenant_access_token，可定向回复任意已加入的群）
 * 失败只记日志并返回 false，绝不抛到订单主流程。
 */
export declare class FeishuClient {
    private cfg;
    /** token 按 appId 分槽：两个应用并行运行时互不覆盖 */
    private tokens;
    private inflight;
    constructor(cfg: FeishuConfigService);
    get enabled(): boolean;
    /** 骑手应用是否可用（凭证齐全 + 飞书启用） */
    get riderEnabled(): boolean;
    /** 按用途选凭证；骑手应用缺失时返回空对象，调用方据此降级 */
    private appCreds;
    /** 推送到群自定义机器人（or 单群 webhook）；reasonOut（§119）回填失败原因，供后台展示 */
    sendWebhook(text: string, reasonOut?: {
        reason: string;
    }): Promise<boolean>;
    /** 以自建应用身份发到指定群；骑手应用缺失时直接失败，ops 应用缺失时退回 webhook */
    sendToChat(chatId: string, text: string, opts?: {
        atAll?: boolean;
        reasonOut?: {
            reason: string;
        };
        app?: FeishuApp;
    }): Promise<boolean>;
    /** 发交互卡片，返回 message_id（失败 null；调用方自行降级） */
    sendCard(chatId: string, card: unknown, app?: FeishuApp): Promise<string | null>;
    /** 更新已发送的卡片（局部刷新，不刷屏） */
    updateCard(messageId: string, card: unknown, app?: FeishuApp): Promise<boolean>;
    /** 线程内回复（reply_in_thread=true 时落进该消息所在话题） */
    replyToMessage(messageId: string, text: string, inThread?: boolean, app?: FeishuApp): Promise<boolean>;
    /** 线程内回卡片（快捷回复面板落进订单话题，不另起话题） */
    replyCard(messageId: string, card: unknown, inThread?: boolean, app?: FeishuApp): Promise<boolean>;
    /** 回读单条消息（用于引用回复解析卡片里的单号） */
    getMessage(messageId: string, app?: FeishuApp): Promise<FeishuMessage | null>;
    /** 读取群消息（新→旧），用于日报去重与话题聚合，不落库 */
    listMessages(chatId: string, startSec: number, endSec: number, pageToken?: string, app?: FeishuApp): Promise<{
        items: FeishuMessage[];
        nextToken?: string;
    }>;
    /** 广播卡片：逐个已映射群发送 */
    broadcastCard(card: unknown): Promise<boolean>;
    private sendMessage;
    private ok;
    private request;
    /** 按订单渠道解析接收群：本店群 + 平台群。未传渠道时返回全部（仅限平台级广播使用）。 */
    chatIdsFor(channelToken?: string): string[];
    /** 骑手群 chat_id（scope='rider'）；未配置为空数组 */
    get riderChatIds(): string[];
    /** 只发骑手群（走骑手独立应用）；返回成功发送的群数（0 表示未配置或全部失败） */
    broadcastRiderCard(card: unknown): Promise<number>;
    /**
     * 广播：优先发到已映射群；没有群映射时退回 webhook。
     * - scope：只发指定范围（platform = 跨店平台群）
     * - channel：店铺定向推送 —— 只发「该店铺群 + 平台群」，避免 A 店告警刷到 B 店群；
     *   若没有任何群命中（例如未配置店铺群）则退回 webhook，保证告警不静默丢失。
     */
    broadcast(text: string, opts?: {
        atAll?: boolean;
        scope?: string;
        channel?: string;
        reasonOut?: {
            reason: string;
        };
    }): Promise<boolean>;
    /**
     * tenant_access_token 缓存：按 appId 分槽（运维/骑手两应用互不覆盖），
     * 提前 5 分钟过期，单飞防并发重复取。
     */
    private tenantToken;
}
