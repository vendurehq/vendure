import { describe, expect, it, vi } from 'vitest';
import { PrivacyNumberService } from './privacy-number.service';
import { privacyProviderStatus } from './waimai-store.service';

/** M3：隐私号服务商实际生效口径 + 运行时降级 */
function makeEnv(cfg: any) {
    const conn = {
        getRepository: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(cfg) })),
    } as any;
    return new PrivacyNumberService(conn);
}

const ctx = { channelId: 7 } as any;

describe('privacyProviderStatus', () => {
    it('未开启号码保护：不算降级', () => {
        expect(privacyProviderStatus({ privacyNumberEnabled: false, privacyNumberProvider: 'aliyun' }))
            .toEqual({ provider: 'aliyun', effective: 'aliyun', degraded: false, note: null });
    });

    it('mock：生效即 mock，无需降级', () => {
        const s = privacyProviderStatus({ privacyNumberEnabled: true, privacyNumberProvider: 'mock' });
        expect(s.effective).toBe('mock');
        expect(s.degraded).toBe(false);
    });

    it('aliyun 缺凭证：回落 mask 且标记降级', () => {
        delete process.env.PRIVACY_ALIYUN_KEY;
        const s = privacyProviderStatus({ privacyNumberEnabled: true, privacyNumberProvider: 'aliyun' });
        expect(s.effective).toBe('mask');
        expect(s.degraded).toBe(true);
        expect(s.note).toContain('PRIVACY_ALIYUN_KEY');
    });

    it('aliyun 配了凭证但接口未接入：仍回落 mask，note 说明待接入', () => {
        process.env.PRIVACY_ALIYUN_KEY = 'dummy';
        const s = privacyProviderStatus({ privacyNumberEnabled: true, privacyNumberProvider: 'aliyun' });
        expect(s.effective).toBe('mask');
        expect(s.degraded).toBe(true);
        expect(s.note).toContain('待接入');
        delete process.env.PRIVACY_ALIYUN_KEY;
    });
});

describe('PrivacyNumberService.resolve', () => {
    it('未开启号码保护：返回真实号且可拨', async () => {
        const svc = makeEnv({ privacyNumberEnabled: false });
        const c = await svc.resolve(ctx, { channelId: 7, phone: '13800000000' });
        expect(c.protected).toBe(false);
        expect(c.display).toBe('13800000000');
        expect(c.callable).toBe('13800000000');
    });

    it('mock：返回虚拟号且可拨（绝不下发真实号）', async () => {
        const svc = makeEnv({ privacyNumberEnabled: true, privacyNumberProvider: 'mock', privacyNumberTtlMinutes: 60 });
        const c = await svc.resolve(ctx, { channelId: 7, orderCode: 'A1', phone: '13800000000' });
        expect(c.protected).toBe(true);
        expect(c.callable).not.toBe('13800000000');
        expect(c.display).not.toBe('13800000000');
        // 同订单重复解析稳定
        const again = await svc.resolve(ctx, { channelId: 7, orderCode: 'A1', phone: '13800000000' });
        expect(again.display).toBe(c.display);
    });

    it('aliyun 未接入：只给脱敏号、不可拨，并带降级原因', async () => {
        delete process.env.PRIVACY_ALIYUN_KEY;
        const svc = makeEnv({ privacyNumberEnabled: true, privacyNumberProvider: 'aliyun' });
        const c = await svc.resolve(ctx, { channelId: 7, orderCode: 'A1', phone: '13800000000' });
        expect(c.protected).toBe(true);
        expect(c.display).toBe('138****0000');
        expect(c.callable).toBeNull();
        expect(c.provider).toBe('mask');
        expect(c.note).toContain('降级');
    });
});
