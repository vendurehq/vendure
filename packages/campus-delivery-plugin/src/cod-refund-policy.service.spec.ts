import { describe, expect, it, vi } from 'vitest';
import { CodRefundPolicyService } from './cod-refund-policy.service';
import { CampusCodRefundLink } from './cod-receipt.entities';

const ctx: any = { activeUserId: 7 };

function makeService(opts: {
    receipt?: { id: number; amount: number; status: string } | null;
    used?: number;
    refundResult?: any;
}) {
    const qb = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        setLock: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(opts.receipt ?? null),
    };
    const linkRepo = {
        create: vi.fn((x: any) => x),
        save: vi.fn(async (x: any) => x),
    };
    const connection: any = {
        getRepository: vi.fn((_ctx: any, entity: any) =>
            entity === CampusCodRefundLink ? linkRepo : { createQueryBuilder: () => qb },
        ),
        rawConnection: { manager: { query: vi.fn(async () => [{ used: opts.used ?? 0 }]) } },
        withTransaction: vi.fn(async (_ctx: any, work: any) => work(_ctx)),
    };
    const orderService: any = { refundOrder: vi.fn(async () => opts.refundResult) };
    return {
        service: new CodRefundPolicyService(connection, orderService),
        linkRepo,
        orderService,
        connection,
    };
}

describe('CodRefundPolicyService', () => {
    it('无收款记录：authorize 抛错（核心不落退款行）', async () => {
        const { service } = makeService({ receipt: null });
        await expect(
            service.authorize(ctx, { order: {} as any, payment: { id: 1 } as any, amount: 100 }),
        ).rejects.toThrow(/没有收款记录/);
    });

    it('超额：authorize 抛错（上限=实收-已退）', async () => {
        const { service } = makeService({ receipt: { id: 11, amount: 500, status: 'confirmed' }, used: 300 });
        await expect(
            service.authorize(ctx, { order: {} as any, payment: { id: 1 } as any, amount: 250 }),
        ).rejects.toThrow(/超过未退实收余额 200 分/);
        await expect(
            service.authorize(ctx, { order: {} as any, payment: { id: 1 } as any, amount: 200 }),
        ).resolves.toMatchObject({ receiptId: 11, transactionId: 'COD-CASH-11' });
    });

    it('有收款且未超额：createRefund 锁收款、建单并写退款关联', async () => {
        const refund = { id: 61, state: 'Settled' } as any;
        const { service, linkRepo, orderService } = makeService({
            receipt: { id: 11, amount: 500, status: 'confirmed' },
            used: 0,
            refundResult: refund,
        });
        const result = await service.createRefund(ctx, {
            orderId: 1,
            paymentId: 2,
            amount: 200,
            reason: '少送一件',
        });
        expect(result).toBe(refund);
        expect(orderService.refundOrder).toHaveBeenCalledTimes(1);
        expect(linkRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({ refundId: 61, receiptId: 11, amountApplied: 200 }),
        );
    });

    it('refundOrder 返回错误：不写关联、原样返回错误', async () => {
        const err = new Error('order state not refundable');
        const { service, linkRepo } = makeService({
            receipt: { id: 11, amount: 500, status: 'confirmed' },
            refundResult: err,
        });
        const result = await service.createRefund(ctx, {
            orderId: 1,
            paymentId: 2,
            amount: 200,
            reason: '退款',
        });
        expect(result).toBe(err);
        expect(linkRepo.save).not.toHaveBeenCalled();
    });
});
