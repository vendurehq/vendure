import { OnApplicationShutdown } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { CampusDedupeService } from './campus-dedupe.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
/**
 * 全局「待退款超 24 小时」巡检（只读）。
 *
 * 之前只有外卖 refund_failed / 售后失败有重试，Vendure 退款单本身停在 Pending 无人发现：
 * createRefund 只落单、不 settleRefund 时，退款单会永久 Pending 且没有任何告警。
 * 本作业只 SELECT + 飞书告警，绝不调用 settleRefund、绝不改任何数据；
 * 真正补打款/人工处理仍由各业务路径与人工工单负责。
 */
export declare class PendingRefundAuditJob implements OnApplicationShutdown {
    private readonly connection;
    private readonly dedupe;
    private readonly feishu;
    private fallback;
    constructor(connection: TransactionalConnection, dedupe: CampusDedupeService, feishu: FeishuNotifyService);
    start(intervalMs?: number): void;
    onApplicationShutdown(): void;
    private runOnce;
    private scan;
}
