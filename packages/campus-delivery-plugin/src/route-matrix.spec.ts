import { describe, expect, it } from 'vitest';
import {
    isRouteDeliverable,
    normalizeRouteFirstLeg,
    resolveRoutePlan,
    resolveDropoff,
    resolveHandoverPoint,
    resolvePickup,
} from './route-matrix';

const handoverPoints = {
    R1: { name: '东门岗亭', address: '东门内 50 米', lat: 30.1, lng: 120.2 },
    R2: { name: '菜鸟驿站', address: '二食堂北侧', lat: 30.2, lng: 120.25 },
};

const base = {
    handoverPoints,
    storeAddress: '一食堂 3 号档口',
    storePhone: '021-0000',
    storeLat: 30.0,
    storeLng: 120.0,
};

const user = { name: '学生', address: '三号楼 502', lat: 30.3, lng: 120.3 };

describe('route-matrix', () => {
    it('R1 默认商户送第一段，第二段恒接力（交接点=校园点）', () => {
        expect(resolveRoutePlan('R1', { ...base })).toEqual({
            route: 'R1',
            leg1: 'merchant',
            leg2: 'campus_rider',
            handover: 'to_campus_rider',
            externalProvider: null,
            dispatch: 'merchant_pool',
        });
    });

    it('R1 改为自营快递后仍是两段接力', () => {
        const cfg = { ...base, routeFirstLeg: { R1: 'owned' } };
        expect(resolveRoutePlan('R1', cfg)).toMatchObject({
            leg1: 'owned',
            leg2: 'campus_rider',
            handover: 'to_campus_rider',
            externalProvider: null,
        });
        expect(resolveDropoff('R1', resolveRoutePlan('R1', cfg)!, cfg, user)).toMatchObject({ name: '东门岗亭' });
    });

    it('R1 不接受外部快递（配置归一为 null，回默认商户）', () => {
        expect(normalizeRouteFirstLeg('R1', 'external')).toBeNull();
        const cfg = { ...base, routeFirstLeg: { R1: 'external' } };
        expect(resolveRoutePlan('R1', cfg)).toMatchObject({ leg1: 'merchant' });
    });

    it('R2 固定外部快递 + 传信者接力；provider 由派单时传入', () => {
        const plan = resolveRoutePlan('R2', { ...base }, 'dada')!;
        expect(plan).toMatchObject({
            leg1: 'external_courier',
            leg2: 'campus_rider',
            handover: 'to_campus_rider',
            externalProvider: 'dada',
            dispatch: 'external_push',
        });
        expect(resolveDropoff('R2', plan, base, user)).toMatchObject({ name: '菜鸟驿站', lat: 30.2 });
    });

    it('R2 未配置交接点 → dropoff 返回 null（不得用 0,0 派单）', () => {
        const cfg = { ...base, handoverPoints: { R1: handoverPoints.R1 } };
        const plan = resolveRoutePlan('R2', cfg)!;
        expect(resolveHandoverPoint('R2', cfg)).toBeNull();
        expect(resolveDropoff('R2', plan, cfg, user)).toBeNull();
    });

    it('多交接点：按收货楼栋坐标取最近', () => {
        const multi = {
            ...base,
            handoverPoints: {
                R1: [
                    { name: '东门岗亭', lat: 30.10, lng: 120.20, isDefault: true },
                    { name: '西门驿站', lat: 30.30, lng: 120.31 },
                ],
            },
        };
        expect(resolveHandoverPoint('R1', multi, { lat: 30.31, lng: 120.32 })?.name).toBe('西门驿站');
        expect(resolveHandoverPoint('R1', multi, { lat: 30.11, lng: 120.21 })?.name).toBe('东门岗亭');
    });

    it('多交接点：无收货坐标用默认点；未标默认则用第一个', () => {
        const multi = {
            ...base,
            handoverPoints: {
                R2: [
                    { name: '菜鸟驿站', lat: 30.2, lng: 120.25 },
                    { name: '体育馆驿站', lat: 30.4, lng: 120.4, isDefault: true },
                ],
            },
        };
        expect(resolveHandoverPoint('R2', multi)?.name).toBe('体育馆驿站');
        const noDefault = {
            ...base,
            handoverPoints: { R2: [{ name: '菜鸟驿站', lat: 30.2, lng: 120.25 }] },
        };
        expect(resolveHandoverPoint('R2', noDefault)?.name).toBe('菜鸟驿站');
    });

    it('R3 默认传信者直送，不接力', () => {
        expect(resolveRoutePlan('R3', { ...base })).toEqual({
            route: 'R3',
            leg1: 'campus_rider',
            leg2: 'none',
            handover: null,
            externalProvider: null,
            dispatch: 'hall_grab',
        });
    });

    it('R3 自营快递整段直送', () => {
        const cfg = { ...base, routeFirstLeg: { R3: 'owned' } };
        expect(resolveRoutePlan('R3', cfg)).toMatchObject({
            leg1: 'owned',
            leg2: 'none',
            handover: null,
            externalProvider: null,
            dispatch: 'hall_grab',
        });
    });

    it('R3 外部快递整段直送（provider 派单时确定）', () => {
        const cfg = { ...base, routeFirstLeg: { R3: 'external' } };
        const plan = resolveRoutePlan('R3', cfg, 'meituan')!;
        expect(plan).toMatchObject({
            leg1: 'external_courier',
            leg2: 'none',
            handover: 'direct_to_user',
            externalProvider: 'meituan',
            dispatch: 'hall_grab',
        });
        expect(resolveDropoff('R3', plan, cfg, user)).toEqual(user);
    });

    it('R4 到店自取、R5 跑腿，均无第二段', () => {
        expect(resolveRoutePlan('R4', base)).toMatchObject({
            leg1: 'self_pickup',
            leg2: 'none',
            handover: null,
            dispatch: 'pickup',
        });
        expect(resolveRoutePlan('R5', base)).toMatchObject({
            leg1: 'campus_rider',
            leg2: 'none',
            handover: null,
            dispatch: 'errand',
        });
    });

    it('R2/R4/R5 不接受承运配置（配了也按固定链路处理）', () => {
        const cfg = { ...base, routeFirstLeg: { R2: 'owned', R4: 'merchant', R5: 'owned' } as Record<string, string> };
        expect(resolveRoutePlan('R2', cfg)).toMatchObject({ leg1: 'external_courier' });
        expect(resolveRoutePlan('R4', cfg)).toMatchObject({ leg1: 'self_pickup' });
        expect(resolveRoutePlan('R5', cfg)).toMatchObject({ leg1: 'campus_rider' });
    });

    it('取货点缺经纬度返回 null；非法值归一为 null；非法路线返回 null', () => {
        expect(resolvePickup('R3', { ...base, storeLat: null, storeLng: null })).toBeNull();
        expect(normalizeRouteFirstLeg('R3', 'merchant')).toBeNull();
        expect(normalizeRouteFirstLeg('R2', 'dada')).toBeNull();
        expect(resolveRoutePlan('R6' as any, base)).toBeNull();
        expect(resolveRoutePlan('R9' as any, base)).toBeNull();
    });
});

describe('isRouteDeliverable（A1：可用交接点判定）', () => {
    it('R1 有可用交接点（单点对象 / 数组）→ true', () => {
        expect(isRouteDeliverable('R1', base)).toBe(true);
        expect(isRouteDeliverable('R1', { ...base, handoverPoints: { R1: [handoverPoints.R1] } })).toBe(true);
    });

    it('R1 未配置 / 配置为空 → false', () => {
        expect(isRouteDeliverable('R1', null)).toBe(false);
        expect(isRouteDeliverable('R1', undefined)).toBe(false);
        expect(isRouteDeliverable('R1', {})).toBe(false);
        expect(isRouteDeliverable('R1', { handoverPoints: null })).toBe(false);
        expect(isRouteDeliverable('R1', { handoverPoints: {} })).toBe(false);
        expect(isRouteDeliverable('R1', { handoverPoints: { R1: [] } })).toBe(false);
    });

    it('R1 交接点缺名称 / 缺经纬度 / 坐标非数字 → 视为不可用', () => {
        expect(
            isRouteDeliverable('R1', { handoverPoints: { R1: { name: '   ', lat: 30.1, lng: 120.2 } } }),
        ).toBe(false);
        expect(
            isRouteDeliverable('R1', { handoverPoints: { R1: { name: '东门岗亭', lng: 120.2 } } as any }),
        ).toBe(false);
        expect(
            isRouteDeliverable('R1', { handoverPoints: { R1: { name: '东门岗亭', lat: 'abc', lng: 120.2 } } as any }),
        ).toBe(false);
    });

    it('一个脏点 + 一个可用点 → true（只要存在可用交接点即可）', () => {
        const cfg = {
            handoverPoints: {
                R1: [
                    { name: '', lat: 30.1, lng: 120.2 },
                    { name: '东门岗亭', lat: 30.1, lng: 120.2 },
                ],
            },
        } as any;
        expect(isRouteDeliverable('R1', cfg)).toBe(true);
    });

    it('经纬度为数字字符串 → 仍视为可用（兼容历史配置）', () => {
        expect(
            isRouteDeliverable('R1', { handoverPoints: { R1: { name: '东门岗亭', lat: '30.1', lng: '120.2' } } } as any),
        ).toBe(true);
    });

    it('R2 与 R1 同判据；R3/R4/R5 不依赖交接点', () => {
        expect(isRouteDeliverable('R2', { handoverPoints: { R1: handoverPoints.R1 } })).toBe(false);
        expect(isRouteDeliverable('R2', base)).toBe(true);
        expect(isRouteDeliverable('R3', null)).toBe(true);
        expect(isRouteDeliverable('R4', null)).toBe(true);
        expect(isRouteDeliverable('R5', null)).toBe(true);
    });
});
