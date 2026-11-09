import { CampusDedupeService } from '../campus-dedupe.service';
import { FeishuCommandService } from './feishu.command.service';
import { FeishuConfigService } from './feishu.config';
import { FeishuApp } from './feishu.client';
import { FeishuRiderGrabService } from './feishu-rider-grab.service';
export interface FeishuEventResult {
    status: number;
    body: Record<string, unknown>;
}
/** 飞书回调签名头（配置 Encrypt Key 后由飞书下发） */
export interface FeishuRequestHeaders {
    timestamp?: string;
    nonce?: string;
    signature?: string;
}
/**
 * 飞书事件订阅入口：URL 验证（challenge）→ 可选解密 → token 校验 → event_id 去重 → 异步执行指令。
 * 先返回 200 再处理业务：飞书 3 秒超时会重试，重试叠加接单/退款很难看；真正的幂等由领域层保证。
 */
export declare class FeishuEventService {
    private cfg;
    private command;
    /** M5 跨实例事件去重（飞书重试可能落到另一实例）；未注入退回进程内 Map */
    private dedupe?;
    /** 骑手群抢单回调（scope='rider'）；事件层按群定位分流，绝不与商家指令共用通道 */
    private riderGrab?;
    private seen;
    constructor(cfg: FeishuConfigService, command: FeishuCommandService, 
    /** M5 跨实例事件去重（飞书重试可能落到另一实例）；未注入退回进程内 Map */
    dedupe?: CampusDedupeService | undefined, 
    /** 骑手群抢单回调（scope='rider'）；事件层按群定位分流，绝不与商家指令共用通道 */
    riderGrab?: FeishuRiderGrabService | undefined);
    /**
     * @param app 回调所属应用：ops=运维告警应用（/feishu/event），rider=骑手独立应用（/feishu/rider/event）。
     *            验签、解密与 token 校验只使用该应用自己的凭证，两个应用的加密回调彻底隔离。
     */
    handle(raw: any, headers?: FeishuRequestHeaders, app?: FeishuApp): Promise<FeishuEventResult>;
    /** 卡片按钮回调：value 里带着完整单号，直接转指令服务（先 200 再异步执行） */
    private handleCardAction;
    /** 按应用限定可处理的群：ops 不收骑手群事件，rider 只收骑手群事件 */
    private acceptChat;
    /** 取该应用的验签/校验令牌配置；rider 缺凭证时返回 null（降级关闭） */
    private appConfig;
    /**
     * 签名校验（H3）：仅当配置了 FEISHU_ENCRYPT_KEY 时启用（飞书只在该模式下下发签名头）。
     * 该模式下请求体是 { encrypt: base64 }，JSON.stringify 可稳定复现签名原文。
     * 未配置 Encrypt Key 时飞书不下发签名，只能依赖 verifyToken（残余风险：token 泄露即可伪造回调）。
     */
    private verifySignature;
    private decode;
    /** 事件订阅与卡片回调可能各有一份验证令牌，支持用逗号并列配置 */
    private verifyTokens;
    private isDuplicate;
}
