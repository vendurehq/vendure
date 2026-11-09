import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { toShopChannelEntries } from './domain-resolver.service';

const channel = (id: number, code: string, token: string, customFields: Record<string, any> = {}) => ({
    id,
    code,
    token,
    customFields,
});

describe('toShopChannelEntries —— shopChannels 的 token 暴露面', () => {
    it('只有当前渠道带 token，其他渠道 token 必须为 null', () => {
        const out = toShopChannelEntries(
            [
                channel(1, '__default_channel__', 'default-token'),
                channel(2, 't1', 'onebridge-dev-token', { shopName: 'ONE BRIDGE' }),
                channel(37, 't2', 't2-token', { shopName: '二月兰' }),
            ],
            2,
        );

        const byCode = Object.fromEntries(out.map(o => [o.code, o]));
        expect(byCode['t1'].token).toBe('onebridge-dev-token');
        expect(byCode['t2'].token).toBeNull();
        expect(byCode['__default_channel__'].token).toBeNull();
    });

    it('未登录（ctx 渠道 = 默认渠道）时只有默认渠道 token 可见', () => {
        const out = toShopChannelEntries(
            [channel(1, '__default_channel__', 'default-token'), channel(2, 't1', 't1-token')],
            1,
        );
        expect(out.find(o => o.code === '__default_channel__')?.token).toBe('default-token');
        expect(out.find(o => o.code === 't1')?.token).toBeNull();
    });

    it('当前渠道不在列表里（或未解析到渠道）时全部为 null', () => {
        const out = toShopChannelEntries([channel(2, 't1', 't1-token')], undefined);
        expect(out[0].token).toBeNull();
    });

    it('停用渠道不返回；默认渠道优先、其余按 code 升序', () => {
        const out = toShopChannelEntries(
            [
                channel(5, 't3', 't3-token'),
                channel(4, 't24', 't24-token', { enabled: false }),
                channel(1, '__default_channel__', 'default-token'),
                channel(3, 't2', 't2-token'),
            ],
            3,
        );
        expect(out.map(o => o.code)).toEqual(['__default_channel__', 't2', 't3']);
    });

    it('isDefault / isOfficial 口径不变（默认渠道恒为官方）', () => {
        const out = toShopChannelEntries(
            [
                channel(1, '__default_channel__', 'default-token'),
                channel(2, 'official-01', 'official-1', { isOfficial: true, tenantNo: 1 }),
                channel(3, 't2', 't2-token', { tenantNo: 2 }),
            ],
            1,
        );
        expect(out.find(o => o.code === '__default_channel__')).toMatchObject({ isDefault: true, isOfficial: true });
        expect(out.find(o => o.code === 'official-01')).toMatchObject({ isDefault: false, isOfficial: true, tenantNo: 1 });
        expect(out.find(o => o.code === 't2')).toMatchObject({ isDefault: false, isOfficial: false, tenantNo: 2 });
    });
});
