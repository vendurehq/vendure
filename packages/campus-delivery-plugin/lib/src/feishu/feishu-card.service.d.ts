import { TransactionalConnection } from '@vendure/core';
import { FeishuClient } from './feishu.client';
import { OrderStatusInput } from './feishu.templates';
/**
 * 订单卡片：数据只从现有 order / campus_building / customer 读，不建表、不落索引。
 * 短码在展示层计算，完整单号只放在按钮 value 里（点击事件原样带回，引用回复也能回读到）。
 *
 * P2.1 告警合并缓存：
 * - codeToMessage   → orderCode → { chats: { chatId: messageId }, at }  （发卡片时写，用于 PATCH 刷新）
 * - codeToAlerts    → orderCode → AlertEntry[]                          （appendAlert 写，buildCard 重建读）
 *
 * 关键：appendAlert 先写入 codeToAlerts → 再调 buildCard（模板渲染时带 alerts 数组）→ updateCard PATCH 整卡。
 *       这样运营点按钮 handler 调 cards.refresh → buildCard 时 alerts 还在 Map 里 → 告警行不会被刷新覆盖丢失。
 */
export declare class FeishuCardService {
    private client;
    private connection;
    private codeToMessage;
    private codeToAlerts;
    constructor(client: FeishuClient, connection: TransactionalConnection);
    /** 告警合并入口：pushEvent 带 orderCode 时先尝试 PATCH 卡片追加告警，返回是否成功 */
    appendAlert(orderCode: string, alertText: string, dedupeKey?: string): Promise<boolean>;
    /** 显式清掉某单的告警行（异常终态改 exception_final 时由 notify 层调用） */
    clearAlerts(orderCode: string): void;
    private gcAlerts;
    private gcMessages;
    /** 读现有表组装卡片所需数据（与文本查单共用同一份视图） */
    loadOrderView(code: string): Promise<OrderStatusInput | null>;
    /** 大厅抢单卡片：按单号读订单，组装取送点/金额/剩余时限（剩余时限按入厅时刻 + 15 分钟计） */
    buildRiderGrabCard(code: string): Promise<Record<string, unknown> | null>;
    buildCard(code: string): Promise<Record<string, unknown> | null>;
    /** 发订单卡片，返回 message_id（用于后续原地刷新） */
    sendOrderCard(chatId: string, code: string): Promise<string | null>;
    /** 订单所属店铺 token（用于告警定向；查不到返回 undefined，调用方按平台级广播处理） */
    channelTokenForOrder(code: string): Promise<string | undefined>;
    /** 新订单卡片：只发「本店群 + 平台群」；一个都没发出去时返回 false，让调用方降级文本。
     *  渠道定向是必须的：旧实现全量群发会把 A 店单号/楼栋/金额泄露到 B 店群。 */
    broadcastOrderCard(code: string, channelToken?: string): Promise<boolean>;
    /** 外部写入 message_id（如用户查单触发 sendOrderCard 后） */
    trackMessage(code: string, chatId: string, messageId: string): void;
    /** 按钮操作后原地刷新卡片（失败不抛错，由调用方决定是否补文本） */
    refresh(messageId: string | undefined, code: string): Promise<boolean>;
}
