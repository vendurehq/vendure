import { CustomerService, ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusChatConversation, CampusChatMessage } from './chat.entities';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { PrivacyNumberService } from './privacy-number.service';
export declare const CHAT_STATUSES: string[];
/**
 * 在线客服 IM（P0-3）：C 端顾客与后台运营/商家的一对多会话（按订单归集）。
 * C 端（shop-api）只能操作本人的会话；后台（admin-api）按当前渠道隔离。
 * 轮询模型：C 端 5s 拉增量消息（afterId），无长连接/推送，部署形态与其它 job 一致。
 */
export declare class ChatService {
    private connection;
    private customerService;
    private feishu;
    /** 号码保护（H2）：可选注入；缺失时（单测/独立装配）退回原文，不影响会话主流程 */
    private privacy?;
    constructor(connection: TransactionalConnection, customerService: CustomerService, feishu: FeishuNotifyService, 
    /** 号码保护（H2）：可选注入；缺失时（单测/独立装配）退回原文，不影响会话主流程 */
    privacy?: PrivacyNumberService | undefined);
    /** 展示号转换器：启用号码保护时脱敏，未启用/依赖缺失时退回原文 */
    private phoneDisplayer;
    private requireCustomer;
    /** 飞书提醒：仅记录日志、绝不阻塞会话（未启用时 pushEvent 直接返回 true） */
    private pushFeishu;
    /** 顾客侧会话归属校验：非本人会话一律当作不存在（防越权读他人会话） */
    private requireOwnConversation;
    /**
     * 发起会话：同一顾客 + 同一订单（orderCode 均相同）已有 open 会话则复用，否则新建。
     * 订单详情「联系客服」与客服中心「在线咨询」都走这里，保证不产生重复会话。
     */
    startConversation(ctx: RequestContext, orderCode?: string | null, subject?: string | null): Promise<any>;
    myConversations(ctx: RequestContext, skip?: number, take?: number): Promise<CampusChatConversation[]>;
    /** 增量拉消息：afterId 之后的新消息（轮询用），缺省返回最近 N 条 */
    messages(ctx: RequestContext, conversationId: ID, afterId?: ID | null, take?: number): Promise<CampusChatMessage[]>;
    /** 顾客发消息：写消息 + 更新会话摘要/未读 + 首条消息推飞书提醒运营 */
    sendMessage(ctx: RequestContext, conversationId: ID, content?: string | null, images?: string[] | null): Promise<any>;
    /** 顾客已读：清顾客未读 + 标记运营消息为已读 */
    markRead(ctx: RequestContext, conversationId: ID): Promise<{
        unreadForCustomer: number;
        channelId: ID;
        customerId: ID;
        orderCode: string | null;
        subject: string | null;
        status: string;
        lastMessage: string | null;
        lastMessageAt: Date | null;
        lastSenderType: string | null;
        unreadForAdmin: number;
        closedAt: Date | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /** 顾客结束会话（可再次发起新会话） */
    closeConversation(ctx: RequestContext, conversationId: ID): Promise<{
        status: string;
        channelId: ID;
        customerId: ID;
        orderCode: string | null;
        subject: string | null;
        lastMessage: string | null;
        lastMessageAt: Date | null;
        lastSenderType: string | null;
        unreadForCustomer: number;
        unreadForAdmin: number;
        closedAt: Date | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    adminConversations(ctx: RequestContext, status?: string, unreadOnly?: boolean, skip?: number, take?: number): Promise<{
        items: {
            customerName: string;
            customerPhone: string | null;
            channelId: ID;
            customerId: ID;
            orderCode: string | null;
            subject: string | null;
            status: string;
            lastMessage: string | null;
            lastMessageAt: Date | null;
            lastSenderType: string | null;
            unreadForCustomer: number;
            unreadForAdmin: number;
            closedAt: Date | null;
            id: ID;
            createdAt: Date;
            updatedAt: Date;
        }[];
        total: number;
    }>;
    adminMessages(ctx: RequestContext, conversationId: ID, afterId?: ID | null, take?: number): Promise<CampusChatMessage[]>;
    /** 后台回复：写消息 + 未读计数给顾客；顺带把运营侧未读清零（正在处理该会话） */
    adminReply(ctx: RequestContext, conversationId: ID, content?: string | null, images?: string[] | null): Promise<any>;
    adminClose(ctx: RequestContext, conversationId: ID): Promise<{
        status: string;
        channelId: ID;
        customerId: ID;
        orderCode: string | null;
        subject: string | null;
        lastMessage: string | null;
        lastMessageAt: Date | null;
        lastSenderType: string | null;
        unreadForCustomer: number;
        unreadForAdmin: number;
        closedAt: Date | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /** 会话列表未读角标：待处理会话数 + 未读消息数（工作台轮询用） */
    adminUnread(ctx: RequestContext): Promise<{
        conversationCount: number;
        messageCount: number;
    }>;
    private requireChannelConversation;
    /** 后台在会话页停留即视为已读：清运营未读 + 标记顾客消息已读 */
    private markSideRead;
    /** 把对方发来的未读消息标记为已读（readAt 幂等：仅补 NULL） */
    private markMessagesRead;
    private orderAsc;
}
