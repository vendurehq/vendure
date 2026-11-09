import { Injectable } from '@nestjs/common';
import {
    CustomerService,
    OrderService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { buildInspectionCode } from '../codes';
import { Errors } from '../errors';
import { InspectionReport } from '../entities';
import { InspectionResult, INSPECTION_RESULTS } from '../types';
import { resolveChannelToken } from './channel-context';
import { OnebridgeRfqService } from './rfq.service';

interface CreateInspectionInput {
    orderCode?: string | null;
    rfqCode?: string | null;
    inspector: string;
    inspectedAt?: Date | string | null;
    result: InspectionResult;
    photos?: string[] | null;
    notesKr?: string | null;
    notesCn?: string | null;
    passed?: boolean | null;
}

interface InspectionListOptions {
    skip?: number;
    take?: number;
    orderCode?: string;
    rfqCode?: string;
    result?: InspectionResult;
    published?: boolean;
}

/** 验货报告（CT-07）：Admin 上传/发布，Shop 仅可见已发布且归属本人的单据。 */
@Injectable()
export class OnebridgeInspectionService {
    constructor(
        private connection: TransactionalConnection,
        private customerService: CustomerService,
        private orderService: OrderService,
        private rfqService: OnebridgeRfqService,
    ) {}

    async create(ctx: RequestContext, input: CreateInspectionInput): Promise<InspectionReport> {
        resolveChannelToken(ctx);
        if (!INSPECTION_RESULTS.includes(input.result)) {
            throw new UserInputError(`Unknown inspection result: ${input.result}`);
        }
        if (!input.inspector?.trim()) throw new UserInputError('inspector is required');
        if (!input.orderCode?.trim() && !input.rfqCode?.trim()) {
            throw new UserInputError('orderCode or rfqCode is required');
        }
        const now = new Date();
        const inspectedAt = input.inspectedAt ? new Date(input.inspectedAt) : now;
        for (let attempt = 0; attempt < 5; attempt++) {
            const prefix = `QC-${buildInspectionCode(now, 1).split('-')[1]}-`;
            const count = await this.repo(ctx)
                .createQueryBuilder('report')
                .where('report.code LIKE :prefix', { prefix: `${prefix}%` })
                .getCount();
            try {
                return await this.repo(ctx).save(
                    new InspectionReport({
                        code: buildInspectionCode(now, count + attempt + 1),
                        orderCode: input.orderCode?.trim() || null,
                        rfqCode: input.rfqCode?.trim() || null,
                        inspector: input.inspector.trim(),
                        inspectedAt,
                        result: input.result,
                        photos: input.photos ?? null,
                        notesKr: input.notesKr ?? null,
                        notesCn: input.notesCn ?? null,
                        passed: input.passed ?? input.result === 'pass',
                    }),
                );
            } catch (e) {
                if (!/unique|duplicate|constraint/i.test((e as any)?.message ?? '')) throw e;
            }
        }
        throw new UserInputError('Unable to allocate inspection code, please retry');
    }

    async publish(ctx: RequestContext, id: string | number): Promise<InspectionReport> {
        resolveChannelToken(ctx);
        const report = await this.repo(ctx).findOne({ where: { id: Number(id) } });
        if (!report) throw new UserInputError(`Inspection report ${id} not found`);
        if (!report.publishedAt) {
            report.publishedAt = new Date();
            await this.repo(ctx).save(report);
        }
        return report;
    }

    async shopList(
        ctx: RequestContext,
        args: { orderCode?: string | null; rfqCode?: string | null },
    ): Promise<InspectionReport[]> {
        resolveChannelToken(ctx);
        if (!args.orderCode && !args.rfqCode) {
            throw new UserInputError('orderCode or rfqCode is required');
        }
        const qb = this.repo(ctx)
            .createQueryBuilder('report')
            .where('report.publishedAt IS NOT NULL');
        if (args.orderCode) {
            await this.assertOrderOwnership(ctx, args.orderCode);
            qb.andWhere('report.orderCode = :orderCode', { orderCode: args.orderCode });
        }
        if (args.rfqCode) {
            await this.rfqService.findRfqForCustomer(ctx, args.rfqCode);
            qb.andWhere('report.rfqCode = :rfqCode', { rfqCode: args.rfqCode });
        }
        return qb.orderBy('report.inspectedAt', 'DESC').getMany();
    }

    async adminList(
        ctx: RequestContext,
        options?: InspectionListOptions,
    ): Promise<{ items: InspectionReport[]; totalItems: number }> {
        resolveChannelToken(ctx);
        const qb = this.repo(ctx).createQueryBuilder('report');
        if (options?.orderCode) qb.andWhere('report.orderCode = :orderCode', { orderCode: options.orderCode });
        if (options?.rfqCode) qb.andWhere('report.rfqCode = :rfqCode', { rfqCode: options.rfqCode });
        if (options?.result) qb.andWhere('report.result = :result', { result: options.result });
        if (options?.published !== undefined) {
            qb.andWhere(
                options.published ? 'report.publishedAt IS NOT NULL' : 'report.publishedAt IS NULL',
            );
        }
        qb.orderBy('report.inspectedAt', 'DESC')
            .skip(Math.max(0, options?.skip ?? 0))
            .take(Math.min(100, Math.max(1, options?.take ?? 20)));
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    private repo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, InspectionReport);
    }

    private async assertOrderOwnership(ctx: RequestContext, orderCode: string): Promise<void> {
        if (!ctx.activeUserId) throw new UserInputError('Authentication required');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['customer']);
        if (!customer || !order || order.customer?.id !== customer.id) {
            throw Errors.orderNotFound(orderCode);
        }
    }
}
