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
    /** 运维应用（告警广播/店铺指令/工单通知） */
    appId?: string;
    appSecret?: string;
    verifyToken?: string;
    encryptKey?: string;
    /**
     * 骑手抢单独立应用（B 方案）：店主已否决复用运维告警机器人。
     * 应用级凭证与 token 均按应用隔离，缺失时只关闭骑手抢单，不影响告警。
     */
    riderAppId?: string;
    riderAppSecret?: string;
    riderVerifyToken?: string;
    riderEncryptKey?: string;
    chats: Record<string, FeishuChatConfig>;
    /** 每日汇总时间 HH:mm（UTC+8） */
    digestAt: string;
}
/** 解析 FEISHU_CHAT_MAP（坏 JSON 只告警并退回空表，绝不抛错） */
export declare function parseChatMap(raw: string | undefined): Record<string, FeishuChatConfig>;
export declare function readFeishuSettings(env?: NodeJS.ProcessEnv): FeishuSettings;
export declare class FeishuConfigService {
    readonly settings: FeishuSettings;
    constructor();
    get enabled(): boolean;
    /** 骑手应用是否具备发送能力（缺任一项即视为未配置） */
    get riderAppConfigured(): boolean;
    /** 骑手群 chat_id 列表（scope='rider'）；未配置返回空数组，调用方只告警不抛错 */
    get riderChatIds(): string[];
    chatOf(chatId: string): FeishuChatConfig | undefined;
}
