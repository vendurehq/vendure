import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Logger, TransactionalConnection } from '@vendure/core';

import { CampusDedupeService } from './campus-dedupe.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { PeriodicFallback } from './periodic-fallback';

const loggerCtx = 'CampusPendingRefundAudit';
const ALERT_TTL_MS = 6 * 3600_000;

/** 同一退款单 6 小时内只告警一次（跨实例经去重表） */
const alertKey = (refundId: number) => `campus:pending_refund_alert:${refundId}`;

interface StuckRefund {
    id: number;
    total: number;
    createdAt: string;
    reason: string | null;
    state: string;
    method: string | null;
    orderId: number | null;
    orderCode: string | null;
}

/**
 * 全局「待退款超 24 小时」巡检（只读）。
 *
 * 之前只有外卖 refund_failed / 售后失败有重试，Vendure 退款单本身停在 Pending 无人发现：
 * createRefund 只落单、不 settleRefund 时，退款单会永久 Pending 且没有任何告警。
 * 本作业只 SELECT + 飞书告警，绝不调用 settleRefund、绝不改任何数据；
 * 真正补打款/人工处理仍由各业务路径与人工工单负责。
 */
@Injectable()
export class PendingRefundAuditJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly dedupe: CampusDedupeService,
        private readonly feishu: FeishuNotifyService,
    ) {}

    start(intervalMs = 10 * 60_000): void {
        this.fallback = new PeriodicFallback({
            name: 'campus-pending-refund-audit',
            intervalMs,
            bootDelayMs: 90_000,
            loggerCtx,
        });
        this.fallback.start(() => this.runOnce());
    }

    onApplicationShutdown(): void {
        this.fallback?.stop();
    }

    private async runOnce(): Promise<void> {
        const stuck = await this.scan();
        if (!stuck.length) return;
        Logger.warn(`退款单待处理超 24 小时：${stuck.length} 笔`, loggerCtx);
        for (const r of stuck) {
            // 去重命中说明近期已告警过；去重不可用时 CampusDedupeService 自带内存降级
            if (await this.dedupe.seenOrMark(alertKey(Number(r.id)), ALERT_TTL_MS)) continue;
            const hours = Math.max(0, (Date.now() - new Date(r.createdAt).getTime()) / 3600_000);
            const detail = [
                `退款单：${r.id}`,
                `订单：${r.orderCode ?? r.orderId ?? '未知'}`,
                `金额：${(Number(r.total) / 100).toFixed(2)} 元（${Number(r.total)} 分）`,
                `卡住：${hours.toFixed(1)} 小时（创建于 ${r.createdAt}）`,
                `来源：${r.method ?? '未知支付方式'}${r.reason ? `／${r.reason}` : ''}`,
                `状态：${r.state}（巡检只读，需人工推进结算）`,
            ].join('；');
            try {
                await this.feishu.pushEvent(
                    'exception',
                    '退款单待处理超 24 小时',
                    detail,
                    r.orderCode ?? undefined,
                    `pending_refund_overdue:${r.id}`,
                );
            } catch (e: any) {
                Logger.error(`退款单超期告警失败 refund=${r.id}: ${String(e?.message ?? e)}`, loggerCtx);
            }
            Logger.error(`退款单待处理超 24 小时 refund=${r.id} order=${r.orderCode ?? '?'} total=${r.total}`, loggerCtx);
        }
    }

    private async scan(): Promise<StuckRefund[]> {
        const out: any = await this.connection.rawConnection.query(
            `SELECT r.id, r.total, r."createdAt", r.reason, r.state,
                    p.method AS method,
                    o.id AS "orderId", o.code AS "orderCode"
               FROM refund r
               JOIN payment p ON r."paymentId" = p.id
               LEFT JOIN "order" o ON p."orderId" = o.id
              WHERE r.state = 'Pending'
                AND r."createdAt" < now() - interval '24 hours'
              ORDER BY r."createdAt"
              LIMIT 200`,
        );
        const rows = Array.isArray(out) ? out[0] : [];
        return (rows ?? []) as StuckRefund[];
    }
}
