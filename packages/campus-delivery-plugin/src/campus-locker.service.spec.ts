import { describe, expect, it, vi } from 'vitest';
import { CampusLockerService } from './campus-locker.service';

/** L1：无人配送不得对未接入的真实厂商伪造受理单号 */
function makeEnv(cfg: any, order: any = { id: 1, channelId: 7 }) {
    const configService = { getConfig: vi.fn().mockResolvedValue(cfg) } as any;
    const conn = {
        getRepository: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(order) })),
    } as any;
    return new CampusLockerService(conn, configService);
}

const ctx = { channelId: 7 } as any;

const baseCfg = {
    unmannedDeliveryEnabled: true,
    unmannedDeliveryProvider: 'mock',
    unmannedDeliveryEndpoint: null,
    unmannedDeliveryKey: null,
};

describe('CampusLockerService.requestDelivery', () => {
    it('mock 通道：模拟受理，单号带 MOCK 前缀并明示未真实下发', async () => {
        const svc = makeEnv({ ...baseCfg });
        const res = await svc.requestDelivery(ctx, 1 as any);
        expect(res.ok).toBe(true);
        expect(res.status).toBe('accepted');
        expect(res.requestNo).toMatch(/^MOCK-/);
        expect(res.message).toContain('未真实下发运单');
    });

    it('真实厂商（meituan）配置齐全但未接入：返回 unsupported，不返回运单号', async () => {
        const svc = makeEnv({
            ...baseCfg,
            unmannedDeliveryProvider: 'meituan',
            unmannedDeliveryEndpoint: 'https://example.com/u',
            unmannedDeliveryKey: 'k',
        });
        const res = await svc.requestDelivery(ctx, 1 as any);
        expect(res.ok).toBe(false);
        expect(res.status).toBe('unsupported');
        expect(res.requestNo).toBeNull();
        expect(res.message).toContain('尚未接入');
    });

    it('通道未开启 → disabled', async () => {
        const svc = makeEnv({ ...baseCfg, unmannedDeliveryEnabled: false });
        const res = await svc.requestDelivery(ctx, 1 as any);
        expect(res.status).toBe('disabled');
        expect(res.requestNo).toBeNull();
    });

    it('真实厂商缺接口地址 → unconfigured（优先于 unsupported）', async () => {
        const svc = makeEnv({ ...baseCfg, unmannedDeliveryProvider: 'meituan', unmannedDeliveryKey: 'k' });
        const res = await svc.requestDelivery(ctx, 1 as any);
        expect(res.status).toBe('unconfigured');
        expect(res.ok).toBe(false);
    });

    it('订单不存在 → 抛「订单不存在」', async () => {
        const svc = makeEnv({ ...baseCfg }, null);
        await expect(svc.requestDelivery(ctx, 1 as any)).rejects.toThrow('订单不存在');
    });
});

/** 前端不再按 provider==='mock' 猜能力：由后端显式下发 integrated 标记 */
describe('CampusLockerService.channel', () => {
    it('mock 通道 integrated=true，真实厂商 integrated=false，providers 逐项带标记', async () => {
        const mockView = await makeEnv({ ...baseCfg }).channel(ctx);
        expect(mockView.integrated).toBe(true);
        const realView = await makeEnv({ ...baseCfg, unmannedDeliveryProvider: 'meituan' }).channel(ctx);
        expect(realView.integrated).toBe(false);
        expect(realView.providers.find((p: any) => p.code === 'mock').integrated).toBe(true);
        expect(realView.providers.find((p: any) => p.code === 'xinshiji').integrated).toBe(false);
    });

    it('未开通（none）integrated=false', async () => {
        const view = await makeEnv({ ...baseCfg, unmannedDeliveryEnabled: false, unmannedDeliveryProvider: 'none' }).channel(ctx);
        expect(view.provider).toBe('none');
        expect(view.integrated).toBe(false);
    });
});
