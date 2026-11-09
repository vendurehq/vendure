import { Injectable } from '@nestjs/common';
import { Logger, Order, TransactionalConnection } from '@vendure/core';

import { CampusBuilding } from '../campus-building.entity';
import { FeishuClient } from './feishu.client';
import { buildOrderCard, buildRiderGrabCard as buildRiderGrabCardTemplate, OrderStatusInput } from './feishu.templates';

const loggerCtx = 'Feishu';
const ALERT_MAX_AGE_MS = 24 * 3600_000;  // 告警超过 24h 没更新 → GC
const MSG_MAX_AGE_MS = 48 * 3600_000;    // message_id 缓存 48h（卡片 PATCH 需要）
const GC_TRIGGER_SIZE = 500;             // Map 超过 500 条触发主动 GC

interface AlertEntry { key: string; text: string; at: number }
interface MsgEntry { chats: Record<string, string>; at: number }

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
@Injectable()
export class FeishuCardService {
    private codeToMessage = new Map<string, MsgEntry>();
    private codeToAlerts = new Map<string, AlertEntry[]>();

    constructor(
        private client: FeishuClient,
        private connection: TransactionalConnection,
    ) {}

    /** 告警合并入口：pushEvent 带 orderCode 时先尝试 PATCH 卡片追加告警，返回是否成功 */
    async appendAlert(orderCode: string, alertText: string, dedupeKey?: string): Promise<boolean> {
        const mapping = this.codeToMessage.get(orderCode);
        if (!mapping) return false;

        // Bug 2 修复：去重用 dedupeKey 精确匹配，不是 title 文本。
        // 相同 dedupeKey + 相同 text 才跳过；相同 dedupeKey 但 text 不同（如 13→14min）追加新行
        const existing = this.codeToAlerts.get(orderCode) ?? [];
        const matched = dedupeKey
            ? existing.find(a => a.key === dedupeKey && a.text === alertText)
            : existing.find(a => a.text === alertText);
        if (matched) return true; // 已在 Map 里，buildCard 会带上

        existing.push({ key: dedupeKey ?? alertText, text: alertText, at: Date.now() });
        // 最多保留 10 条（同单告警不可能超过这个数，超出丢最老的）
        if (existing.length > 10) existing.splice(0, existing.length - 10);
        this.codeToAlerts.set(orderCode, existing);

        // Bug 7 修复：Map 超过阈值主动 GC，按时间清 24h 前的过期数据 + 安全 GC 模式
        if (this.codeToAlerts.size > GC_TRIGGER_SIZE) this.gcAlerts();
        if (this.codeToMessage.size > GC_TRIGGER_SIZE) this.gcMessages();

        let anyOk = false;
        for (const [chatId, messageId] of Object.entries(mapping.chats)) {
            try {
                const card = await this.buildCard(orderCode);
                if (!card) continue;
                const ok = await this.client.updateCard(messageId, card);
                if (ok) anyOk = true;
            } catch { /* 单群失败不影响其他群 */ }
        }
        return anyOk;
    }

    /** 显式清掉某单的告警行（异常终态改 exception_final 时由 notify 层调用） */
    clearAlerts(orderCode: string): void {
        this.codeToAlerts.delete(orderCode);
    }

    // ---------- GC：Bug 7 修复：安全模式（数组收集再统一 delete），按时间清 ----------

    private gcAlerts(): void {
        const now = Date.now();
        const expired: string[] = [];
        for (const [code, alerts] of this.codeToAlerts) {
            // 整条过期（最后一条告警时间戳）或数组本身过期
            const lastAt = Math.max(...alerts.map(a => a.at), 0);
            if (now - lastAt > ALERT_MAX_AGE_MS) expired.push(code);
        }
        for (const k of expired) this.codeToAlerts.delete(k);
    }

    private gcMessages(): void {
        const now = Date.now();
        const expired: string[] = [];
        for (const [code, entry] of this.codeToMessage) {
            if (now - entry.at > MSG_MAX_AGE_MS) expired.push(code);
        }
        for (const k of expired) this.codeToMessage.delete(k);
    }

    // ---------- 数据加载 ----------

    /** 读现有表组装卡片所需数据（与文本查单共用同一份视图） */
    async loadOrderView(code: string): Promise<OrderStatusInput | null> {
        if (!code) return null;
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { code },
            relations: ['channels'],
        });
        if (!order) return null;
        const cf = order.customFields as any;

        let building: string | null = null;
        if (cf?.buildingId) {
            const b = await this.connection.rawConnection.getRepository(CampusBuilding).findOne({
                where: { id: String(cf.buildingId) as any },
            });
            building = b?.name ?? null;
        }

        let riderName: string | null = null;
        if (cf?.deliveryStaffId) {
            const rider: any = await this.connection.rawConnection.getRepository('Customer').findOne({
                where: { id: Number(cf.deliveryStaffId) },
            });
            riderName = rider?.customFields?.riderRealName ?? null;
        }

        const reportedAt = cf?.exceptionReportedAt ? new Date(cf.exceptionReportedAt).getTime() : NaN;
        // Bug 1 修复：从 codeToAlerts Map 读告警历史注入 views
        const alerts = this.codeToAlerts.get(code)?.map(a => a.text) ?? [];
        return {
            code: order.code,
            store: order.channels?.[0]?.code ?? '',
            orderState: String(order.state),
            hallStatus: cf?.hallStatus ?? null,
            deliveryStatus: cf?.deliveryStatus ?? null,
            route: cf?.fulfillmentRoute ?? null,
            riderName,
            building,
            zone: cf?.campusZone ?? null,
            slotText: cf?.deliverySlotText ?? null,
            total: order.total,
            exceptionType: cf?.exceptionType ?? null,
            exceptionNote: cf?.exceptionNote ?? null,
            exceptionMinutes: Number.isNaN(reportedAt) ? null : Math.round((Date.now() - reportedAt) / 60_000),
            // order.createdAt 是 DB now() 写入的 UTC 墙钟，告警卡片展示前先还原成绝对时刻
            createdAt: (order.createdAt).getTime(),
            at: Date.now(),
            alerts,
        };
    }

    /** 大厅抢单卡片：按单号读订单，组装取送点/金额/剩余时限（剩余时限按入厅时刻 + 15 分钟计） */
    async buildRiderGrabCard(code: string): Promise<Record<string, unknown> | null> {
        if (!code) return null;
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { code },
            relations: ['channels'],
        });
        if (!order) return null;
        const cf = order.customFields as any;
        let building: string | null = null;
        if (cf?.buildingId) {
            const b = await this.connection.rawConnection.getRepository(CampusBuilding).findOne({
                where: { id: String(cf.buildingId) as any },
            });
            building = b?.name ?? null;
        }
        const addr = [building, cf?.campusZone, cf?.deliverySlotText].filter(Boolean).join(' ') || '校园内';
        const enteredAt = cf?.hallEnteredAt ? new Date(cf.hallEnteredAt).getTime() : (order.createdAt as any).getTime();
        const remainingMinutes = 15 - (Date.now() - enteredAt) / 60_000;
        return buildRiderGrabCardTemplate({
            code: order.code,
            orderId: order.id,
            addr,
            total: order.total,
            remainingMinutes,
        });
    }

    async buildCard(code: string): Promise<Record<string, unknown> | null> {
        const view = await this.loadOrderView(code);
        return view ? buildOrderCard(view) : null;
    }

    /** 发订单卡片，返回 message_id（用于后续原地刷新） */
    async sendOrderCard(chatId: string, code: string): Promise<string | null> {
        const card = await this.buildCard(code);
        if (!card) return null;
        return this.client.sendCard(chatId, card);
    }

    /** 订单所属店铺 token（用于告警定向；查不到返回 undefined，调用方按平台级广播处理） */
    async channelTokenForOrder(code: string): Promise<string | undefined> {
        if (!code) return undefined;
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { code },
            relations: ['channels'],
        });
        return order?.channels?.[0]?.token;
    }

    /** 新订单卡片：只发「本店群 + 平台群」；一个都没发出去时返回 false，让调用方降级文本。
     *  渠道定向是必须的：旧实现全量群发会把 A 店单号/楼栋/金额泄露到 B 店群。 */
    async broadcastOrderCard(code: string, channelToken?: string): Promise<boolean> {
        if (!this.client.enabled) return false;
        const card = await this.buildCard(code);
        if (!card) return false;
        const chats = this.client.chatIdsFor(channelToken);
        const msgMap: Record<string, string> = {};
        let ok = false;
        for (const chatId of chats) {
            const mid = await this.client.sendCard(chatId, card);
            if (mid) { msgMap[chatId] = mid; ok = true; }
        }
        if (ok) this.codeToMessage.set(code, { chats: msgMap, at: Date.now() });
        return ok;
    }

    /** 外部写入 message_id（如用户查单触发 sendOrderCard 后） */
    trackMessage(code: string, chatId: string, messageId: string): void {
        const cur = this.codeToMessage.get(code) ?? { chats: {}, at: 0 };
        cur.chats[chatId] = messageId;
        cur.at = Date.now();
        this.codeToMessage.set(code, cur);
    }

    /** 按钮操作后原地刷新卡片（失败不抛错，由调用方决定是否补文本） */
    async refresh(messageId: string | undefined, code: string): Promise<boolean> {
        if (!messageId) return false;
        const card = await this.buildCard(code); // loadOrderView 里会从 codeToAlerts 注入 alerts → Bug 1 修复
        if (!card) return false;
        try {
            return await this.client.updateCard(messageId, card);
        } catch (e: any) {
            Logger.warn(`飞书卡片刷新失败 message=${messageId}: ${e?.message ?? e}`, loggerCtx);
            return false;
        }
    }
}
