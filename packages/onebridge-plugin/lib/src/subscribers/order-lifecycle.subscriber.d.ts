import { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { EventBus, TransactionalConnection } from '@vendure/core';
/**
 * 订单生命周期订阅（A4 修复）：
 * 1. 下单（AddingItems → ArrangingPayment）写时间轴第 0 节点，避免 paid 单只有支付一条节点；
 * 2. 回填下单流程应写的跨境字段：crossBorderStage / businessLine / krwAmount。
 *    C 端通过 `setOrderCustomFields` 提交过的值一律不覆盖（只补空值）。
 */
export declare class OnebridgeOrderLifecycleSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
    private eventBus;
    private connection;
    private subscription?;
    constructor(eventBus: EventBus, connection: TransactionalConnection);
    onApplicationBootstrap(): void;
    onApplicationShutdown(): void;
    private onOrderPlaced;
    /** 幂等写「订单创建」节点（重复下单事件不产生重复节点） */
    private writeCreatedNode;
    private backfillCustomFields;
}
