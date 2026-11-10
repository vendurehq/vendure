"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const rfq_service_1 = require("../services/rfq.service");
(0, vitest_1.describe)('OnebridgeRfqService.myRfqs', () => {
    const ctx = { channel: { token: 'onebridge' }, activeUserId: 1 };
    function createService() {
        const qb = {
            where: vitest_1.vi.fn().mockReturnThis(),
            andWhere: vitest_1.vi.fn().mockReturnThis(),
            orderBy: vitest_1.vi.fn().mockReturnThis(),
            skip: vitest_1.vi.fn().mockReturnThis(),
            take: vitest_1.vi.fn().mockReturnThis(),
            getManyAndCount: vitest_1.vi.fn().mockResolvedValue([[], 0]),
        };
        const repo = { createQueryBuilder: vitest_1.vi.fn(() => qb) };
        const connection = { getRepository: vitest_1.vi.fn(() => repo) };
        const customerService = { findOneByUserId: vitest_1.vi.fn().mockResolvedValue({ id: 7 }) };
        const service = new rfq_service_1.OnebridgeRfqService(connection, customerService);
        return { service, qb };
    }
    (0, vitest_1.it)('keeps channel + customer isolation, default order, take and skip', async () => {
        const { service, qb } = createService();
        await service.myRfqs(ctx);
        (0, vitest_1.expect)(qb.where).toHaveBeenCalledWith('rfq.channelToken = :channelToken AND rfq.customerId = :customerId', { channelToken: 'onebridge', customerId: 7 });
        (0, vitest_1.expect)(qb.andWhere).not.toHaveBeenCalled();
        (0, vitest_1.expect)(qb.orderBy).toHaveBeenCalledWith('rfq.createdAt', 'DESC');
        (0, vitest_1.expect)(qb.take).toHaveBeenCalledWith(20);
        (0, vitest_1.expect)(qb.skip).toHaveBeenCalledWith(0);
    });
    (0, vitest_1.it)('applies needType, stage and trimmed keyword filters', async () => {
        const { service, qb } = createService();
        await service.myRfqs(ctx, { needType: 'projects', stage: 'sourcing', keyword: '  OB-2026  ' });
        (0, vitest_1.expect)(qb.andWhere).toHaveBeenNthCalledWith(1, 'rfq.needType = :needType', { needType: 'projects' });
        (0, vitest_1.expect)(qb.andWhere).toHaveBeenNthCalledWith(2, 'rfq.stage = :stage', { stage: 'sourcing' });
        (0, vitest_1.expect)(qb.andWhere).toHaveBeenNthCalledWith(3, '(rfq.code LIKE :kw OR rfq.item LIKE :kw OR rfq.customerName LIKE :kw)', { kw: '%OB-2026%' });
    });
    (0, vitest_1.it)('ignores blank keyword and clamps take/skip', async () => {
        const { service, qb } = createService();
        await service.myRfqs(ctx, { keyword: '   ', take: 500, skip: -10 });
        (0, vitest_1.expect)(qb.andWhere).not.toHaveBeenCalled();
        (0, vitest_1.expect)(qb.take).toHaveBeenCalledWith(100);
        (0, vitest_1.expect)(qb.skip).toHaveBeenCalledWith(0);
    });
});
//# sourceMappingURL=rfq-my-list.spec.js.map