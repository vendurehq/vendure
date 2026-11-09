import { describe, expect, it } from 'vitest';
import { FORCE_CANCEL_MARK, campusCancelGuardProcess } from './cancel-guard.process';

const guard = campusCancelGuardProcess.onTransitionStart as any;

describe('campusCancelGuardProcess', () => {
    const shop = { apiType: 'shop' } as any;
    const admin = { apiType: 'admin' } as any;

    it('C 端已送达 → 拒绝取消', async () => {
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: shop,
            order: { customFields: { deliveredAt: new Date(), hallStatus: 'delivered' } },
        })).rejects.toThrow('订单已送达');
    });

    it('C 端骑手已取货（in_progress）→ 拒绝取消', async () => {
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: shop,
            order: { customFields: { deliveryStatus: 'in_progress', hallStatus: 'grabbed' } },
        })).rejects.toThrow('骑手已接单或配送中');
    });

    it('C 端外部运单已接单 → 拒绝取消', async () => {
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: shop,
            order: { customFields: { thirdPartyState: 'accepted', hallStatus: 'third_party' } },
        })).rejects.toThrow('骑手已接单或配送中');
    });

    it('C 端商户自配送中 → 拒绝取消', async () => {
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: shop,
            order: { customFields: { hallStatus: 'merchant_delivering' } },
        })).rejects.toThrow('骑手已接单或配送中');
    });

    it('C 端未取货（仍在大厅）→ 允许取消', async () => {
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: shop,
            order: { customFields: { hallStatus: 'open' } },
        })).resolves.toBeUndefined();
    });

    it('后台取消未送达（apiType=admin）→ 不受限', async () => {
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: admin,
            order: { customFields: { deliveryStatus: 'in_progress', hallStatus: 'grabbed' } },
        })).resolves.toBeUndefined();
    });

    it('后台取消已送达 → 拒绝（A11）', async () => {
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: admin,
            order: { customFields: { hallStatus: 'delivered', deliveryStatus: 'delivered' } },
        })).rejects.toThrow('已拦截后台/系统取消');
    });

    it('系统自动取消已送达（admin ctx、无强制标记）→ 拒绝', async () => {
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: admin,
            order: { customFields: { deliveredAt: new Date() } },
        })).rejects.toThrow('已拦截后台/系统取消');
    });

    it('仅 deliveryStatus=delivered 也视为已送达 → 拒绝', async () => {
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: admin,
            order: { customFields: { deliveryStatus: 'delivered' } },
        })).rejects.toThrow('已拦截后台/系统取消');
    });

    it('带强制标记（含理由）→ 放行已送达单', async () => {
        const forced = { apiType: 'admin', [FORCE_CANCEL_MARK]: { reason: '对账补正' } } as any;
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: forced,
            order: { customFields: { hallStatus: 'delivered' } },
        })).resolves.toBeUndefined();
    });

    it('强制标记理由为空 → 仍拒绝', async () => {
        const forced = { apiType: 'admin', [FORCE_CANCEL_MARK]: { reason: '   ' } } as any;
        await expect(guard('PaymentSettled', 'Cancelled', {
            ctx: forced,
            order: { customFields: { hallStatus: 'delivered' } },
        })).rejects.toThrow('已拦截后台/系统取消');
    });

    it('非取消过渡 → 不拦截', async () => {
        await expect(guard('PaymentSettled', 'Shipped', {
            ctx: shop,
            order: { customFields: { deliveryStatus: 'in_progress' } },
        })).resolves.toBeUndefined();
    });
});
