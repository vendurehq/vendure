import { Injectable } from '@nestjs/common';
import {
    CustomerService,
    Order,
    OrderService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { Errors } from '../errors';
import { CustomsRecord, StageEvent } from '../entities';
import { STAGE_META } from '../stages';
import { CUSTOMS_STATUSES, CustomsStatus } from '../types';
import { resolveChannelToken } from './channel-context';

interface UpsertCustomsInput {
    orderCode: string;
    customsStatus?: CustomsStatus;
    declaredAt?: Date | string | null;
    clearedAt?: Date | string | null;
    hsCode?: string | null;
    declarationNo?: string | null;
    note?: string | null;
    docs?: string[] | null;
    idempotencyKey?: string | null;
}

interface CustomsListOptions {
    skip?: number;
    take?: number;
    customsStatus?: CustomsStatus;
    keyword?: string;
}

/** 清关状态机（CT-06）；只允许前进与 hold 兜底，非法回退返回 CUSTOMS_SYNC_FAILED。 */
const CUSTOMS_FLOW: Record<CustomsStatus, readonly CustomsStatus[]> = {
    not_started: ['docs_preparing', 'declared', 'hold'],
    docs_preparing: ['declared', 'hold'],
    declared: ['inspecting', 'cleared', 'hold'],
    inspecting: ['cleared', 'hold'],
    cleared: ['hold'],
    hold: ['docs_preparing', 'declared', 'inspecting', 'cleared'],
};

@Injectable()
export class OnebridgeCustomsService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private customerService: CustomerService,
    ) {}

    async upsert(ctx: RequestContext, input: UpsertCustomsInput): Promise<CustomsRecord> {
        const channelToken = resolveChannelToken(ctx);
        if (!input.orderCode?.trim()) throw new UserInputError('orderCode is required');
        if (input.customsStatus && !CUSTOMS_STATUSES.includes(input.customsStatus)) {
            throw new UserInputError(`Unknown customs status: ${input.customsStatus}`);
        }
        const repo = this.repo(ctx);
        if (input.idempotencyKey) {
            const hit = await repo.findOne({ where: { idempotencyKey: input.idempotencyKey } });
            // 幂等命中直接返回最后已知状态，不重复写时间轴/订单阶段
            if (hit) return hit;
        }
        const orderCode = input.orderCode.trim();
        const existing = await repo.findOne({ where: { orderCode } });
        const record = existing ?? new CustomsRecord({ orderCode, customsStatus: 'not_started' });
        const nextStatus = input.customsStatus ?? record.customsStatus;
        if (existing && nextStatus !== record.customsStatus && !CUSTOMS_FLOW[record.customsStatus].includes(nextStatus)) {
            throw Errors.customsSyncFailed(
                `Illegal customs transition: ${record.customsStatus} -> ${nextStatus}`,
            );
        }
        record.customsStatus = nextStatus;
        record.declaredAt = this.asDate(input.declaredAt) ?? record.declaredAt;
        record.clearedAt = this.asDate(input.clearedAt) ?? record.clearedAt;
        if (nextStatus === 'declared' && !record.declaredAt) record.declaredAt = new Date();
        if (nextStatus === 'cleared' && !record.clearedAt) record.clearedAt = new Date();
        if (input.hsCode !== undefined) record.hsCode = input.hsCode?.trim() || null;
        if (input.declarationNo !== undefined) record.declarationNo = input.declarationNo?.trim() || null;
        if (input.note !== undefined) record.note = input.note;
        if (input.docs !== undefined) record.docs = input.docs;
        record.lastSyncedAt = new Date();
        record.idempotencyKey = input.idempotencyKey ?? record.idempotencyKey;
        const saved = await repo.save(record);

        if (nextStatus === 'cleared') {
            await this.onCleared(ctx, orderCode, channelToken);
        }
        return saved;
    }

    async findByOrderCode(ctx: RequestContext, orderCode: string): Promise<CustomsRecord | null> {
        resolveChannelToken(ctx);
        return this.repo(ctx).findOne({ where: { orderCode } });
    }

    async shopFind(ctx: RequestContext, orderCode: string): Promise<CustomsRecord | null> {
        resolveChannelToken(ctx);
        await this.assertOrderOwnership(ctx, orderCode);
        return this.repo(ctx).findOne({ where: { orderCode } });
    }

    async adminList(
        ctx: RequestContext,
        options?: CustomsListOptions,
    ): Promise<{ items: CustomsRecord[]; totalItems: number }> {
        resolveChannelToken(ctx);
        const qb = this.repo(ctx).createQueryBuilder('record');
        if (options?.customsStatus) {
            qb.andWhere('record.customsStatus = :status', { status: options.customsStatus });
        }
        if (options?.keyword) {
            qb.andWhere('(record.orderCode LIKE :kw OR record.declarationNo LIKE :kw)', {
                kw: `%${options.keyword.trim()}%`,
            });
        }
        qb.orderBy('record.lastSyncedAt', 'DESC')
            .skip(Math.max(0, options?.skip ?? 0))
            .take(Math.min(100, Math.max(1, options?.take ?? 20)));
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    private repo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, CustomsRecord);
    }

    /** cleared 回写：订单业务阶段 + 时间轴事件（幂等：同一订单只留一条 customs 节点） */
    private async onCleared(ctx: RequestContext, orderCode: string, channelToken: string): Promise<void> {
        const stageRepo = this.connection.getRepository(ctx, StageEvent);
        const existingEvent = await stageRepo.findOne({
            where: { ownerType: 'order', ownerCode: orderCode, stage: 'customs' },
        });
        if (!existingEvent) {
            const label = STAGE_META.customs.labelZh;
            await stageRepo.save(
                new StageEvent({
                    ownerType: 'order',
                    ownerCode: orderCode,
                    stage: 'customs',
                    // TODO(韩文待补)：韩文文案缺失，titleKr 暂用中文占位
                    titleKr: label,
                    titleCn: label,
                    descKr: null,
                    descCn: null,
                    state: 'now',
                    occurredAt: new Date(),
                    operator: ctx.activeUserId ? String(ctx.activeUserId) : null,
                    idempotencyKey: `customs:${channelToken}:${orderCode}:cleared`,
                }),
            );
        }
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['customer', 'lines', 'surcharges']);
        if (!order) return;
        const customFields = order.customFields as Record<string, unknown>;
        if (customFields.crossBorderStage !== 'customs') {
            customFields.crossBorderStage = 'customs';
            await this.connection.getRepository(ctx, Order).save(order);
        }
    }

    private async assertOrderOwnership(ctx: RequestContext, orderCode: string): Promise<void> {
        if (!ctx.activeUserId) throw new UserInputError('Authentication required');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['customer']);
        if (!customer || !order || order.customer?.id !== customer.id) {
            throw Errors.orderNotFound(orderCode);
        }
    }

    private asDate(value: Date | string | null | undefined): Date | null {
        if (!value) return null;
        return value instanceof Date ? value : new Date(value);
    }
}
