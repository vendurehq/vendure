import { RequestContextService, TransactionalConnection } from '@vendure/core';
import { HallGrabService } from '../hall-grab.service';
import { RiderService } from '../rider.service';
import { FeishuClient } from './feishu.client';
import { FeishuConfigService } from './feishu.config';
/**
 * 骑手群抢单回调：飞书 open_id → 骑手 Customer → 构造带 activeUserId 的 ctx → 复用 HallGrabService.grab。
 * 权限判定全部落在 grab → assertApprovedRider（骑手状态/信用分/合规），本服务不重复实现。
 * 与商家群指令隔离：本服务只认 scope='rider' 的群和 rider_grab 动作，绝不转发给 FeishuCommandService。
 */
export declare class FeishuRiderGrabService {
    private cfg;
    private client;
    private connection;
    private requestContextService;
    private riderService;
    private hallGrab;
    constructor(cfg: FeishuConfigService, client: FeishuClient, connection: TransactionalConnection, requestContextService: RequestContextService, riderService: RiderService, hallGrab: HallGrabService);
    /** 骑手群判定（事件层分流用） */
    isRiderChat(chatId: string): boolean;
    /** 骑手群文本消息：只提示点卡片按钮，不解析任何指令（避免复用商家指令面） */
    handleText(input: {
        chatId: string;
        openId: string;
        text?: string;
    }): Promise<void>;
    /** 卡片回调：校验群 scope 与动作 → 反查骑手 → 抢单 → 回执 */
    handleCardAction(input: {
        chatId: string;
        openId: string;
        value?: any;
        messageId?: string;
    }): Promise<void>;
    /** 优先回在卡片话题里，拿不到锚点消息时退回群消息 */
    private reply;
}
