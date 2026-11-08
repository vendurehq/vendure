import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MerchantAdminService } from './merchant-admin.service';

/** 构造 KDS 队列测试环境：只 mock 本方法用到的 repo/查询器，其余依赖不参与 */
function makeSvc(orders: any[]) {
    const qb: any = {};
    qb.leftJoin = vi.fn(() => qb);
    qb.where = vi.fn(() => qb);
    qb.andWhere = vi.fn(() => qb);
    qb.leftJoinAndSelect = vi.fn(() => qb);
    qb.orderBy = vi.fn(() => qb);
    qb.getMany = vi.fn(async () => orders);

    const repo = {
        createQueryBuilder: vi.fn(() => qb),
        findByIds: vi.fn(async () => []),
    };
    const connection: any = {
        getRepository: vi.fn(() => repo),
        rawConnection: { query: vi.fn(async () => []) },
    };
    const svc = new MerchantAdminService(
        connection,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );
    return { svc, qb };
}

const now = Date.now();
const minutesAgo = (n: number) => new Date(now - n * 60_000);

describe('kitchenQueue（KDS 出餐屏队列）', () => {
    it('已自动接管的 owned_pool 单进入备餐中，且标记 autoTaken、不作待接单', async () => {
        const { svc, qb } = makeSvc([
            {
                id: 100, code: 'OWN1', createdAt: minutesAgo(5), total: 2000,
                customFields: { hallStatus: 'owned_pool', buildingId: null },
                lines: [{ quantity: 1, productVariant: { name: '招牌饭' }, customFields: {} }],
            },
            {
                id: 101, code: 'PEN1', createdAt: minutesAgo(3), total: 1500,
                customFields: { hallStatus: 'pending_merchant', buildingId: null },
                lines: [{ quantity: 1, productVariant: { name: '奶茶' }, customFields: {} }],
            },
            {
                id: 102, code: 'COOK1', createdAt: minutesAgo(8), total: 1800,
                customFields: { hallStatus: 'accepted', buildingId: null },
                lines: [{ quantity: 2, productVariant: { name: '炒饭' }, customFields: {} }],
            },
        ]);

        const queue = await svc.kitchenQueue({ channelId: 'c1' } as any);

        // 查询口径必须包含 owned_pool / owned_dispatched（否则自动接管单在出餐屏永远不可见）
        expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('owned_pool'));
        expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('owned_dispatched'));
        // 已取餐（in_progress / pickedUpAt）必须被查询排除
        expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining("deliveryStatus = 'in_progress'"));
        expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('pickedUpAt IS NOT NULL'));

        const owned = queue.tickets.find(t => t.id === '100')!;
        expect(owned.stage).toBe('cooking');
        expect(owned.autoTaken).toBe(true);

        const pending = queue.tickets.find(t => t.id === '101')!;
        expect(pending.stage).toBe('pending');
        expect(pending.autoTaken).toBe(false);

        const cooking = queue.tickets.find(t => t.id === '102')!;
        expect(cooking.stage).toBe('cooking');
        expect(cooking.autoTaken).toBe(false);

        expect(queue.pendingCount).toBe(1);
        expect(queue.cookingCount).toBe(2);
    });

    it('owned_dispatched 已接单未取餐：仍在备餐中列，stage 与纯净池区分且 autoTaken', async () => {
        const { svc } = makeSvc([
            {
                id: 200, code: 'DISP1', createdAt: minutesAgo(6), total: 2200,
                customFields: { hallStatus: 'owned_dispatched', deliveryStatus: 'assigned', buildingId: null },
                lines: [{ quantity: 1, productVariant: { name: '牛肉面' }, customFields: {} }],
            },
        ]);

        const queue = await svc.kitchenQueue({ channelId: 'c1' } as any);

        expect(queue.tickets).toHaveLength(1);
        const t = queue.tickets[0];
        expect(t.stage).toBe('cooking_assigned');
        expect(t.autoTaken).toBe(true);
        // 仍计入备餐中，不落到待接单
        expect(queue.cookingCount).toBe(1);
        expect(queue.pendingCount).toBe(0);
    });

    it('owned_dispatched 已取餐（in_progress / pickedUpAt）：不在屏上', async () => {
        const { svc } = makeSvc([
            {
                id: 300, code: 'PICK1', createdAt: minutesAgo(9), total: 2600,
                customFields: { hallStatus: 'owned_dispatched', deliveryStatus: 'in_progress', buildingId: null },
                lines: [{ quantity: 1, productVariant: { name: '饺子' }, customFields: {} }],
            },
            {
                id: 301, code: 'PICK2', createdAt: minutesAgo(7), total: 2400,
                customFields: { hallStatus: 'owned_dispatched', deliveryStatus: 'assigned', pickedUpAt: minutesAgo(1), buildingId: null },
                lines: [{ quantity: 1, productVariant: { name: '粥' }, customFields: {} }],
            },
        ]);

        const queue = await svc.kitchenQueue({ channelId: 'c1' } as any);

        // 即使查询返回了已取餐单，也不得挂在看板上
        expect(queue.tickets).toHaveLength(0);
        expect(queue.cookingCount).toBe(0);
    });
});
