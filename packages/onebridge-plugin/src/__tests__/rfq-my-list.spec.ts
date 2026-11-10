import { describe, expect, it, vi } from 'vitest';

import { OnebridgeRfqService } from '../services/rfq.service';

describe('OnebridgeRfqService.myRfqs', () => {
    const ctx = { channel: { token: 'onebridge' }, activeUserId: 1 } as any;

    function createService() {
        const qb = {
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            take: vi.fn().mockReturnThis(),
            getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
        };
        const repo = { createQueryBuilder: vi.fn(() => qb) };
        const connection = { getRepository: vi.fn(() => repo) };
        const customerService = { findOneByUserId: vi.fn().mockResolvedValue({ id: 7 }) };
        const service = new OnebridgeRfqService(connection as any, customerService as any);
        return { service, qb };
    }

    it('keeps channel + customer isolation, default order, take and skip', async () => {
        const { service, qb } = createService();

        await service.myRfqs(ctx);

        expect(qb.where).toHaveBeenCalledWith(
            'rfq.channelToken = :channelToken AND rfq.customerId = :customerId',
            { channelToken: 'onebridge', customerId: 7 },
        );
        expect(qb.andWhere).not.toHaveBeenCalled();
        expect(qb.orderBy).toHaveBeenCalledWith('rfq.createdAt', 'DESC');
        expect(qb.take).toHaveBeenCalledWith(20);
        expect(qb.skip).toHaveBeenCalledWith(0);
    });

    it('applies needType, stage and trimmed keyword filters', async () => {
        const { service, qb } = createService();

        await service.myRfqs(ctx, { needType: 'projects', stage: 'sourcing', keyword: '  OB-2026  ' });

        expect(qb.andWhere).toHaveBeenNthCalledWith(1, 'rfq.needType = :needType', { needType: 'projects' });
        expect(qb.andWhere).toHaveBeenNthCalledWith(2, 'rfq.stage = :stage', { stage: 'sourcing' });
        expect(qb.andWhere).toHaveBeenNthCalledWith(
            3,
            '(rfq.code LIKE :kw OR rfq.item LIKE :kw OR rfq.customerName LIKE :kw)',
            { kw: '%OB-2026%' },
        );
    });

    it('ignores blank keyword and clamps take/skip', async () => {
        const { service, qb } = createService();

        await service.myRfqs(ctx, { keyword: '   ', take: 500, skip: -10 });

        expect(qb.andWhere).not.toHaveBeenCalled();
        expect(qb.take).toHaveBeenCalledWith(100);
        expect(qb.skip).toHaveBeenCalledWith(0);
    });
});
