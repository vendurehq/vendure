import { Injectable } from '@nestjs/common';
import { CustomerService, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { buildRfqCode } from '../codes';
import { Errors } from '../errors';
import { InspectionReport, Rfq, RfqQuote, RfqSample, StageEvent } from '../entities';
import { STAGE_META } from '../stages';
import { assertRfqTransition } from '../transitions';
import {
    BusinessLine,
    CROSS_BORDER_STAGES,
    CrossBorderStage,
    NEED_TYPES,
    NeedType,
    StageEventState,
} from '../types';
import { resolveChannelToken } from './channel-context';

interface SubmitRfqInput {
    need: NeedType;
    name: string;
    contact: string;
    item: string;
    qty?: string | null;
    eta?: string | null;
    memo?: string | null;
    locale: 'ko' | 'zh';
    idempotencyKey?: string | null;
}

interface RfqListOptions {
    skip?: number;
    take?: number;
    needType?: NeedType;
    stage?: CrossBorderStage;
    keyword?: string;
}

interface SaveQuoteInput {
    amount: number;
    currency?: 'KRW' | 'CNY';
    validUntil?: Date | string | null;
    note?: string | null;
}

interface SaveSampleInput {
    status: string;
    trackingNo?: string | null;
    confirmedAt?: Date | string | null;
}

/**
 * 前台模块 → 初始阶段/业务线（CT-01 + CT-02）。
 * daily 走标准订单，提交即待付款；logistics 为横切底座，无独立业务线。
 */
const NEED_INITIAL: Record<NeedType, { labelZh: string; stage: CrossBorderStage; line: BusinessLine | null }> = {
    logistics: { labelZh: '物流通道询价', stage: 'requirement', line: null },
    daily: { labelZh: '日用精选询价', stage: 'wait_pay', line: 'net' },
    collections: { labelZh: '精选专栏询价', stage: 'quoting', line: 'pond' },
    projects: { labelZh: '项目定制询价', stage: 'requirement', line: 'hook' },
};

function isUniqueViolation(e: unknown): boolean {
    const message = (e as any)?.message ?? '';
    return /unique|duplicate|constraint/i.test(message);
}

function asDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    return value instanceof Date ? value : new Date(value);
}

@Injectable()
export class OnebridgeRfqService {
    constructor(
        private connection: TransactionalConnection,
        private customerService: CustomerService,
    ) {}

    // ===== Shop =====

    async submitRfq(ctx: RequestContext, input: SubmitRfqInput): Promise<Rfq> {
        const channelToken = resolveChannelToken(ctx);
        this.validateSubmitInput(input);

        if (input.idempotencyKey) {
            const existing = await this.rfqRepo(ctx).findOne({ where: { idempotencyKey: input.idempotencyKey } });
            if (existing) {
                if (existing.channelToken !== channelToken) {
                    throw Errors.validationFailed('idempotencyKey belongs to another channel');
                }
                return existing;
            }
        }

        const now = new Date();
        const customerId = await this.currentCustomerId(ctx);
        const meta = NEED_INITIAL[input.need];
        const base = {
            channelToken,
            needType: input.need,
            needLabel: meta.labelZh,
            customerName: input.name.trim(),
            customerContact: input.contact.trim(),
            locale: input.locale,
            item: input.item.trim(),
            qty: input.qty?.trim() || null,
            eta: input.eta?.trim() || null,
            memo: input.memo?.trim() || null,
            stage: meta.stage,
            businessLine: meta.line,
            customerId,
            idempotencyKey: input.idempotencyKey ?? null,
        };

        for (let attempt = 0; attempt < 5; attempt++) {
            const code = await this.nextRfqCode(ctx, now, attempt);
            try {
                const saved = await this.rfqRepo(ctx).save(new Rfq({ ...base, code }));
                await this.appendStageEvent(ctx, {
                    ownerType: 'rfq',
                    ownerCode: code,
                    stage: meta.stage,
                    occurredAt: now,
                    state: 'now',
                    idempotencyKey: input.idempotencyKey ? `submitRfq:${input.idempotencyKey}` : null,
                });
                return saved;
            } catch (e) {
                // 并发下编号或幂等键冲突：命中幂等键则返回已存在单据，否则重试下一个序号
                if (input.idempotencyKey) {
                    const existing = await this.rfqRepo(ctx).findOne({
                        where: { idempotencyKey: input.idempotencyKey },
                    });
                    if (existing) return existing;
                }
                if (!isUniqueViolation(e)) throw e;
            }
        }
        throw new UserInputError('Unable to allocate RFQ code, please retry');
    }

    async myRfqs(ctx: RequestContext, options?: RfqListOptions): Promise<{ items: Rfq[]; totalItems: number }> {
        const channelToken = resolveChannelToken(ctx);
        const customerId = await this.requireCustomerId(ctx);
        const take = Math.min(100, Math.max(1, options?.take ?? 20));
        const skip = Math.max(0, options?.skip ?? 0);
        const [items, totalItems] = await this.rfqRepo(ctx).findAndCount({
            where: { channelToken, customerId },
            order: { createdAt: 'DESC' },
            skip,
            take,
        });
        return { items, totalItems };
    }

    async findRfqForCustomer(ctx: RequestContext, code: string): Promise<Rfq> {
        const channelToken = resolveChannelToken(ctx);
        const customerId = await this.requireCustomerId(ctx);
        const rfq = await this.rfqRepo(ctx).findOne({ where: { code, channelToken } });
        if (!rfq || rfq.customerId !== customerId) {
            throw Errors.rfqNotFound(code);
        }
        return rfq;
    }

    // ===== Admin =====

    async adminList(
        ctx: RequestContext,
        options?: RfqListOptions,
    ): Promise<{ items: Rfq[]; totalItems: number }> {
        const channelToken = resolveChannelToken(ctx);
        const qb = this.rfqRepo(ctx).createQueryBuilder('rfq').where('rfq.channelToken = :channelToken', {
            channelToken,
        });
        if (options?.needType) qb.andWhere('rfq.needType = :needType', { needType: options.needType });
        if (options?.stage) qb.andWhere('rfq.stage = :stage', { stage: options.stage });
        if (options?.keyword) {
            qb.andWhere('(rfq.code LIKE :kw OR rfq.customerName LIKE :kw)', {
                kw: `%${options.keyword.trim()}%`,
            });
        }
        qb.orderBy('rfq.createdAt', 'DESC')
            .skip(Math.max(0, options?.skip ?? 0))
            .take(Math.min(100, Math.max(1, options?.take ?? 20)));
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    async adminFind(ctx: RequestContext, id?: string | number, code?: string): Promise<Rfq> {
        const channelToken = resolveChannelToken(ctx);
        const rfq = await this.rfqRepo(ctx).findOne({
            where: id ? { id: Number(id), channelToken } : { code: code ?? '', channelToken },
        });
        if (!rfq) throw Errors.rfqNotFound(code);
        return rfq;
    }

    async saveQuote(ctx: RequestContext, rfqId: string | number, input: SaveQuoteInput): Promise<RfqQuote> {
        const rfq = await this.adminFind(ctx, rfqId);
        if (!Number.isInteger(input.amount) || input.amount < 0) {
            throw Errors.validationFailed('quote amount must be a non-negative integer');
        }
        const repo = this.connection.getRepository(ctx, RfqQuote);
        const existing = await repo.findOne({ where: { rfqId: Number(rfq.id) } });
        const quote = existing ?? new RfqQuote({ rfqId: Number(rfq.id) });
        quote.amount = input.amount;
        quote.currency = input.currency ?? 'KRW';
        quote.validUntil = asDate(input.validUntil) ?? undefined;
        quote.note = input.note?.trim() || null;
        return repo.save(quote);
    }

    async saveSample(ctx: RequestContext, rfqId: string | number, input: SaveSampleInput): Promise<RfqSample> {
        const rfq = await this.adminFind(ctx, rfqId);
        if (!input.status?.trim()) throw Errors.validationFailed('sample status is required');
        const repo = this.connection.getRepository(ctx, RfqSample);
        const existing = await repo.findOne({ where: { rfqId: Number(rfq.id) } });
        const sample = existing ?? new RfqSample({ rfqId: Number(rfq.id) });
        sample.status = input.status.trim();
        sample.trackingNo = input.trackingNo?.trim() || null;
        sample.confirmedAt = asDate(input.confirmedAt) ?? undefined;
        return repo.save(sample);
    }

    async transitionStage(
        ctx: RequestContext,
        rfqId: string | number,
        target: CrossBorderStage,
        detail?: { title?: string | null; desc?: string | null; idempotencyKey?: string | null },
    ): Promise<Rfq> {
        if (!CROSS_BORDER_STAGES.includes(target)) {
            throw Errors.validationFailed(`unknown CrossBorderStage: ${target}`);
        }
        const rfq = await this.adminFind(ctx, rfqId);
        if (detail?.idempotencyKey) {
            const existing = await this.stageEventRepo(ctx).findOne({
                where: { idempotencyKey: detail.idempotencyKey },
            });
            if (existing) return rfq;
        }
        assertRfqTransition(rfq.stage, target);

        // 未通过验货不放行（§8.4）：qc → customs/delivered 前校验最新报告
        if (rfq.stage === 'qc' && (target === 'customs' || target === 'delivered')) {
            const latest = await this.connection.getRepository(ctx, InspectionReport).findOne({
                where: { rfqCode: rfq.code },
                order: { inspectedAt: 'DESC' },
            });
            if (latest && !latest.passed) {
                throw Errors.inspectionNotPassed(rfq.code);
            }
        }

        const from = rfq.stage;
        rfq.stage = target;
        const saved = await this.rfqRepo(ctx).save(rfq);
        await this.stageEventRepo(ctx).update(
            { ownerType: 'rfq', ownerCode: rfq.code, state: 'now' as StageEventState },
            { state: 'done' as StageEventState },
        );
        const terminal = target === 'done' || target === 'lost';
        await this.appendStageEvent(ctx, {
            ownerType: 'rfq',
            ownerCode: rfq.code,
            stage: target,
            occurredAt: new Date(),
            state: terminal ? 'done' : 'now',
            title: detail?.title,
            desc: detail?.desc,
            idempotencyKey: detail?.idempotencyKey ?? null,
            operator: ctx.activeUserId ? String(ctx.activeUserId) : null,
        });
        // 便于审计排查：保留前后状态（不落专表，日志为轻量留痕）
        // eslint-disable-next-line no-console
        console.log(`[OnebridgeRFQ] ${rfq.code} ${from} -> ${target}`);
        return saved;
    }

    // ===== 关联读取 =====

    async loadQuote(ctx: RequestContext, rfqId: number): Promise<RfqQuote | null> {
        return this.connection.getRepository(ctx, RfqQuote).findOne({ where: { rfqId } });
    }

    async loadSample(ctx: RequestContext, rfqId: number): Promise<RfqSample | null> {
        return this.connection.getRepository(ctx, RfqSample).findOne({ where: { rfqId } });
    }

    async loadTimeline(ctx: RequestContext, rfqCode: string): Promise<StageEvent[]> {
        return this.stageEventRepo(ctx).find({
            where: { ownerType: 'rfq', ownerCode: rfqCode },
            order: { occurredAt: 'ASC' },
        });
    }

    // ===== 内部 =====

    private rfqRepo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, Rfq);
    }

    private stageEventRepo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, StageEvent);
    }

    private async nextRfqCode(ctx: RequestContext, now: Date, attempt: number): Promise<string> {
        const prefix = `OB-${buildRfqCode(now, 1).split('-')[1]}-`;
        const count = await this.rfqRepo(ctx)
            .createQueryBuilder('rfq')
            .where('rfq.code LIKE :prefix', { prefix: `${prefix}%` })
            .getCount();
        return buildRfqCode(now, count + attempt + 1);
    }

    private async appendStageEvent(
        ctx: RequestContext,
        input: {
            ownerType: 'rfq' | 'order';
            ownerCode: string;
            stage: CrossBorderStage;
            occurredAt: Date;
            state: StageEventState;
            title?: string | null;
            desc?: string | null;
            idempotencyKey?: string | null;
            operator?: string | null;
        },
    ): Promise<StageEvent> {
        const label = STAGE_META[input.stage]?.labelZh ?? input.stage;
        // TODO(韩文待补)：CT-01 未提供韩文文案，titleKr/descKr 暂以中文占位，禁止自造韩文
        return this.stageEventRepo(ctx).save(
            new StageEvent({
                ownerType: input.ownerType,
                ownerCode: input.ownerCode,
                stage: input.stage,
                titleKr: input.title || label,
                titleCn: input.title || label,
                descKr: input.desc ?? null,
                descCn: input.desc ?? null,
                state: input.state,
                occurredAt: input.occurredAt,
                operator: input.operator ?? null,
                idempotencyKey: input.idempotencyKey ?? null,
            }),
        );
    }

    private validateSubmitInput(input: SubmitRfqInput): void {
        if (!NEED_TYPES.includes(input.need)) {
            throw Errors.validationFailed(`unknown need type: ${input.need}`);
        }
        if (!input.name?.trim() || input.name.trim().length > 100) {
            throw Errors.validationFailed('name is required and must be <= 100 chars');
        }
        if (!input.contact?.trim() || input.contact.trim().length > 200) {
            throw Errors.validationFailed('contact is required and must be <= 200 chars');
        }
        if (!input.item?.trim() || input.item.trim().length > 1000) {
            throw Errors.validationFailed('item is required and must be <= 1000 chars');
        }
        if (input.memo && input.memo.length > 2000) {
            throw Errors.validationFailed('memo must be <= 2000 chars');
        }
        if (input.locale !== 'ko' && input.locale !== 'zh') {
            throw Errors.validationFailed('locale must be ko or zh');
        }
    }

    private async requireCustomerId(ctx: RequestContext): Promise<number> {
        if (!ctx.activeUserId) throw new UserInputError('Authentication required');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('No customer for the current user');
        return Number(customer.id);
    }

    private async currentCustomerId(ctx: RequestContext): Promise<number | null> {
        if (!ctx.activeUserId) return null;
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        return customer ? Number(customer.id) : null;
    }
}
