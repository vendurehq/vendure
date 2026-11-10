import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { EventBus, Logger, Order, OrderPlacedEvent, RequestContext, TransactionalConnection } from '@vendure/core';
import { Subscription } from 'rxjs';

import { StageEvent } from '../entities';
import { timelineNodeCopy } from '../i18n';
import { isOnebridgeChannel } from '../services/channel-context';
import { BusinessLine, CrossBorderStage, loggerCtx, NeedType } from '../types';

/** 时间轴第 0 个节点代表的业务阶段（与 C 端 STAGE_NODE_STAGE[line][0] 一致） */
const FIRST_NODE_STAGE: Record<BusinessLine, CrossBorderStage> = {
    net: 'wait_pay',
    pond: 'quoting',
    hook: 'requirement',
};

/** needType → 业务线（CT-01/CT-02）；logistics 为横切底座，无独立业务线 */
const NEED_BUSINESS_LINE: Record<NeedType, BusinessLine | null> = {
    logistics: null,
    daily: 'net',
    collections: 'pond',
    projects: 'hook',
};

/**
 * 订单生命周期订阅（A4 修复）：
 * 1. 下单（AddingItems → ArrangingPayment）写时间轴第 0 节点，避免 paid 单只有支付一条节点；
 * 2. 回填下单流程应写的跨境字段：crossBorderStage / businessLine / krwAmount。
 *    C 端通过 `setOrderCustomFields` 提交过的值一律不覆盖（只补空值）。
 */
@Injectable()
export class OnebridgeOrderLifecycleSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
    private subscription?: Subscription;

    constructor(private eventBus: EventBus, private connection: TransactionalConnection) {}

    onApplicationBootstrap(): void {
        this.subscription = this.eventBus.ofType(OrderPlacedEvent).subscribe(event => {
            void this.onOrderPlaced(event).catch((error: unknown) => {
                Logger.error(
                    `order lifecycle failed: ${error instanceof Error ? error.message : String(error)}`,
                    loggerCtx,
                );
            });
        });
    }

    onApplicationShutdown(): void {
        this.subscription?.unsubscribe();
    }

    private async onOrderPlaced(event: OrderPlacedEvent): Promise<void> {
        const { ctx, order } = event;
        if (!isOnebridgeChannel(ctx)) return;

        const customFields = (order.customFields ?? {}) as Record<string, any>;
        const needType = customFields.needType as NeedType | undefined;
        const businessLine =
            (customFields.businessLine as BusinessLine | undefined) ??
            (needType ? NEED_BUSINESS_LINE[needType] : 'net');
        const line: BusinessLine = businessLine ?? 'net';

        await this.writeCreatedNode(ctx, order, line);
        await this.backfillCustomFields(ctx, order, customFields, businessLine, line);
    }

    /** 幂等写「订单创建」节点（重复下单事件不产生重复节点） */
    private async writeCreatedNode(ctx: RequestContext, order: Order, line: BusinessLine): Promise<void> {
        const repo = this.connection.getRepository(ctx, StageEvent);
        const idempotencyKey = `order:${ctx.channel.token}:${order.code}:created`;
        const existing = await repo.findOne({ where: { idempotencyKey } });
        if (existing) return;

        const copy = timelineNodeCopy(line, 0, 'zh');
        await repo.save(
            new StageEvent({
                ownerType: 'order',
                ownerCode: order.code,
                stage: FIRST_NODE_STAGE[line],
                // TODO(韩文待定稿)：韩文缺失，按约定回落中文占位
                titleKr: copy.title,
                titleCn: copy.title,
                descKr: null,
                descCn: copy.desc,
                state: 'done',
                occurredAt: new Date(),
                operator: 'system',
                idempotencyKey,
            }),
        );
    }

    private async backfillCustomFields(
        ctx: RequestContext,
        order: Order,
        customFields: Record<string, any>,
        businessLine: BusinessLine | null,
        line: BusinessLine,
    ): Promise<void> {
        const patch: Record<string, unknown> = {};
        if (!customFields.crossBorderStage) patch.crossBorderStage = FIRST_NODE_STAGE[line];
        if (!customFields.businessLine && businessLine) patch.businessLine = businessLine;
        // KRW 订单：krwAmount 默认取订单含税总额（KRW factor=1，不放大 100 倍）
        if (customFields.krwAmount == null && order.currencyCode === 'KRW') {
            patch.krwAmount = order.totalWithTax;
        }
        if (Object.keys(patch).length === 0) return;

        await this.connection.getRepository(ctx, Order).update(order.id, {
            customFields: { ...customFields, ...patch } as any,
        });
    }
}
