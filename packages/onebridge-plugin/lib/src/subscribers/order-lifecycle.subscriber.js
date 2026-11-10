"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnebridgeOrderLifecycleSubscriber = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const entities_1 = require("../entities");
const i18n_1 = require("../i18n");
const channel_context_1 = require("../services/channel-context");
const types_1 = require("../types");
/** 时间轴第 0 个节点代表的业务阶段（与 C 端 STAGE_NODE_STAGE[line][0] 一致） */
const FIRST_NODE_STAGE = {
    net: 'wait_pay',
    pond: 'quoting',
    hook: 'requirement',
};
/** needType → 业务线（CT-01/CT-02）；logistics 为横切底座，无独立业务线 */
const NEED_BUSINESS_LINE = {
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
let OnebridgeOrderLifecycleSubscriber = class OnebridgeOrderLifecycleSubscriber {
    constructor(eventBus, connection) {
        this.eventBus = eventBus;
        this.connection = connection;
    }
    onApplicationBootstrap() {
        this.subscription = this.eventBus.ofType(core_1.OrderPlacedEvent).subscribe(event => {
            void this.onOrderPlaced(event).catch((error) => {
                core_1.Logger.error(`order lifecycle failed: ${error instanceof Error ? error.message : String(error)}`, types_1.loggerCtx);
            });
        });
    }
    onApplicationShutdown() {
        var _a;
        (_a = this.subscription) === null || _a === void 0 ? void 0 : _a.unsubscribe();
    }
    async onOrderPlaced(event) {
        var _a, _b;
        const { ctx, order } = event;
        if (!(0, channel_context_1.isOnebridgeChannel)(ctx))
            return;
        const customFields = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        const needType = customFields.needType;
        const businessLine = (_b = customFields.businessLine) !== null && _b !== void 0 ? _b : (needType ? NEED_BUSINESS_LINE[needType] : 'net');
        const line = businessLine !== null && businessLine !== void 0 ? businessLine : 'net';
        await this.writeCreatedNode(ctx, order, line);
        await this.backfillCustomFields(ctx, order, customFields, businessLine, line);
    }
    /** 幂等写「订单创建」节点（重复下单事件不产生重复节点） */
    async writeCreatedNode(ctx, order, line) {
        const repo = this.connection.getRepository(ctx, entities_1.StageEvent);
        const idempotencyKey = `order:${ctx.channel.token}:${order.code}:created`;
        const existing = await repo.findOne({ where: { idempotencyKey } });
        if (existing)
            return;
        const copy = (0, i18n_1.timelineNodeCopy)(line, 0, 'zh');
        await repo.save(new entities_1.StageEvent({
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
        }));
    }
    async backfillCustomFields(ctx, order, customFields, businessLine, line) {
        const patch = {};
        if (!customFields.crossBorderStage)
            patch.crossBorderStage = FIRST_NODE_STAGE[line];
        if (!customFields.businessLine && businessLine)
            patch.businessLine = businessLine;
        // KRW 订单：krwAmount 默认取订单含税总额（KRW factor=1，不放大 100 倍）
        if (customFields.krwAmount == null && order.currencyCode === 'KRW') {
            patch.krwAmount = order.totalWithTax;
        }
        if (Object.keys(patch).length === 0)
            return;
        await this.connection.getRepository(ctx, core_1.Order).update(order.id, {
            customFields: Object.assign(Object.assign({}, customFields), patch),
        });
    }
};
exports.OnebridgeOrderLifecycleSubscriber = OnebridgeOrderLifecycleSubscriber;
exports.OnebridgeOrderLifecycleSubscriber = OnebridgeOrderLifecycleSubscriber = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.EventBus, core_1.TransactionalConnection])
], OnebridgeOrderLifecycleSubscriber);
//# sourceMappingURL=order-lifecycle.subscriber.js.map