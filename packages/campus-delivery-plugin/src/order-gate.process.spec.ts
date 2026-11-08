import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    bindOrderGateConnection,
    campusOrderGateProcess,
    CampusR1NoHandoverError,
    findChannelRouteConfig,
    findSoldOutProductName,
    isBlacklisted,
    R1_NO_HANDOVER_CODE,
    R1_NO_HANDOVER_MESSAGE,
} from './order-gate.process';

/** 当前校园时刻在营业时间内（10:00-22:00 用真实时间无法稳定断言，这里用「未配置」场景之外的分支单测） */

function data(opts: { channelCf?: any; cf?: any; id?: number; channelId?: number } = {}) {
    return {
        ctx: {
            channelId: opts.channelId ?? 2,
            channel: { customFields: opts.channelCf ?? {} },
        } as any,
        order: { id: opts.id ?? 101, customFields: opts.cf ?? {} } as any,
    } as any;
}

describe('campusOrderGateProcess', () => {
    const query = vi.fn();
    /** 事务内 manager（限量并发占用校验用）；本组用例无命中限量商品，不会真正执行 */
    const managerQuery = vi.fn();
    beforeEach(() => {
        vi.clearAllMocks();
        // 固定校园时刻 12:00（UTC+8 → UTC 04:00），让营业时间判断可稳定断言
        vi.useFakeTimers();
        vi.setSystemTime(new Date(Date.UTC(2026, 9, 25, 4, 0, 0)));
        bindOrderGateConnection({
            rawConnection: { query },
            getRepository: () => ({ manager: { query: managerQuery } }),
        } as any);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('非 ArrangingPayment 放行（不做任何查询）', async () => {
        await expect(
            campusOrderGateProcess.onTransitionStart!('AddingItems', 'PaymentAuthorized', data()),
        ).resolves.toBeUndefined();
        expect(query).not.toHaveBeenCalled();
    });

    it('已打烊拦截（当前 12:00 不在 10:00-11:00 营业时段）', async () => {
        await expect(
            campusOrderGateProcess.onTransitionStart!('AddingItems', 'ArrangingPayment', data({ channelCf: { waimaiBusinessHours: '10:00-11:00' } })),
        ).rejects.toThrow('店铺已打烊');
        expect(query).not.toHaveBeenCalled();
    });

    it('跑腿单豁免营业时间校验', async () => {
        query.mockResolvedValue([]);
        await expect(
            campusOrderGateProcess.onTransitionStart!(
                'AddingItems', 'ArrangingPayment',
                data({ channelCf: { waimaiBusinessHours: '10:00-11:00' }, cf: { orderKind: 'errand' } }),
            ),
        ).resolves.toBeUndefined();
    });

    it('黑名单命中拦截', async () => {
        query
            .mockResolvedValueOnce([])                              // 营业日历：无配置行（未休业）
            .mockResolvedValueOnce([{ customerId: 9, phone: '13800000000' }])
            .mockResolvedValueOnce([{ exists: 1 }]);
        await expect(
            campusOrderGateProcess.onTransitionStart!('AddingItems', 'ArrangingPayment', data()),
        ).rejects.toThrow('暂不可下单');
    });

    it('营业日历今日休业拦截（文案带备注）', async () => {
        query.mockResolvedValueOnce([{ closureDates: '[{"date":"2026-10-25","note":"国庆假期"}]' }]);
        await expect(
            campusOrderGateProcess.onTransitionStart!('AddingItems', 'ArrangingPayment', data()),
        ).rejects.toThrow('本店今日休业（国庆假期）');
    });

    it('商品沽清拦截（文案带商品名）', async () => {
        query
            .mockResolvedValueOnce([])                              // 营业日历
            .mockResolvedValueOnce([{ customerId: 9, phone: null }]) // 顾客查询
            .mockResolvedValueOnce([])                             // 黑名单未命中
            .mockResolvedValueOnce([{ name: '香辣鸡腿堡' }]);        // 沽清命中
        await expect(
            campusOrderGateProcess.onTransitionStart!('AddingItems', 'ArrangingPayment', data()),
        ).rejects.toThrow('香辣鸡腿堡');
    });

    it('无黑名单/无沽清时放行', async () => {
        query
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ customerId: 9, phone: null }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
        await expect(
            campusOrderGateProcess.onTransitionStart!('AddingItems', 'ArrangingPayment', data()),
        ).resolves.toBeUndefined();
    });

    describe('配送路线闸门（防支付后永不进厅）', () => {
        beforeEach(() => query.mockResolvedValue([]));

        /** 只让「渠道交接点配置」查询返回指定值，其余查询仍返回空（未休业/无黑名单/无沽清/无限量） */
        function mockHandoverPoints(rows: any[]) {
            query.mockImplementation((sql: string) =>
                Promise.resolve(String(sql).includes('"handoverPoints"') ? rows : []),
            );
        }

        it('已选校园交付点但路线为空 → 拦截', async () => {
            await expect(
                campusOrderGateProcess.onTransitionStart!(
                    'AddingItems', 'ArrangingPayment',
                    data({ cf: { campusZone: '东区', buildingId: '7' } }),
                ),
            ).rejects.toThrow('配送路线缺失或无效');
        });

        it('路线非法（R9）→ 拦截', async () => {
            await expect(
                campusOrderGateProcess.onTransitionStart!(
                    'AddingItems', 'ArrangingPayment',
                    data({ cf: { fulfillmentRoute: 'R9', campusZone: '东区', buildingId: '7' } }),
                ),
            ).rejects.toThrow('配送路线缺失或无效');
        });

        it('R1/R2/R3 缺楼栋 → 拦截', async () => {
            await expect(
                campusOrderGateProcess.onTransitionStart!(
                    'AddingItems', 'ArrangingPayment',
                    data({ cf: { fulfillmentRoute: 'R1', campusZone: '东区' } }),
                ),
            ).rejects.toThrow('配送楼栋');
        });

        it('R1 + 楼栋齐全 + 已配置可用交接点 → 放行', async () => {
            mockHandoverPoints([{ handoverPoints: { R1: { name: '东门岗亭', lat: 30.1, lng: 120.2 } } }]);
            await expect(
                campusOrderGateProcess.onTransitionStart!(
                    'AddingItems', 'ArrangingPayment',
                    data({ cf: { fulfillmentRoute: 'R1', campusZone: '东区', buildingId: '7' } }),
                ),
            ).resolves.toBeUndefined();
        });

        it('R1 + 楼栋齐全但未配置交接点 → 拦截（可读文案 + 业务错误码）', async () => {
            mockHandoverPoints([]);
            const err: any = await campusOrderGateProcess
                .onTransitionStart!(
                    'AddingItems', 'ArrangingPayment',
                    data({ cf: { fulfillmentRoute: 'R1', campusZone: '东区', buildingId: '7' } }),
                )
                .catch(e => e);
            expect(err).toBeInstanceOf(CampusR1NoHandoverError);
            expect(err.message).toBe(R1_NO_HANDOVER_MESSAGE);
            expect(err.extensions.code).toBe(R1_NO_HANDOVER_CODE);
        });

        it('R1 交接点缺经纬度（脏数据）→ 拦截', async () => {
            mockHandoverPoints([{ handoverPoints: { R1: { name: '东门岗亭' } } }]);
            await expect(
                campusOrderGateProcess.onTransitionStart!(
                    'AddingItems', 'ArrangingPayment',
                    data({ cf: { fulfillmentRoute: 'R1', campusZone: '东区', buildingId: '7' } }),
                ),
            ).rejects.toThrow(R1_NO_HANDOVER_MESSAGE);
        });

        it('R3 + 楼栋齐全 → 不校验交接点，直接放行', async () => {
            const queried: string[] = [];
            query.mockImplementation((sql: string) => {
                queried.push(String(sql));
                return Promise.resolve([]);
            });
            await expect(
                campusOrderGateProcess.onTransitionStart!(
                    'AddingItems', 'ArrangingPayment',
                    data({ cf: { fulfillmentRoute: 'R3', campusZone: '东区', buildingId: '7' } }),
                ),
            ).resolves.toBeUndefined();
            expect(queried.some(s => s.includes('"handoverPoints"'))).toBe(false);
        });

        it('无校园交付意图（普通快递/到店自取）→ 不校验路线', async () => {
            await expect(
                campusOrderGateProcess.onTransitionStart!('AddingItems', 'ArrangingPayment', data()),
            ).resolves.toBeUndefined();
        });

        it('跑腿单无路线 → 豁免', async () => {
            await expect(
                campusOrderGateProcess.onTransitionStart!(
                    'AddingItems', 'ArrangingPayment',
                    data({ cf: { orderKind: 'errand' } }),
                ),
            ).resolves.toBeUndefined();
        });
    });
});

describe('helpers', () => {
    it('isBlacklisted：无顾客记录返回 false', async () => {
        const conn: any = { rawConnection: { query: vi.fn().mockResolvedValue([]) } };
        await expect(isBlacklisted(conn, 2, 1)).resolves.toBe(false);
    });

    it('findSoldOutProductName：无命中返回 null', async () => {
        const conn: any = { rawConnection: { query: vi.fn().mockResolvedValue([]) } };
        await expect(findSoldOutProductName(conn, 1)).resolves.toBeNull();
    });

    it('findChannelRouteConfig：无配置行返回 { handoverPoints: null }', async () => {
        const conn: any = { rawConnection: { query: vi.fn().mockResolvedValue([]) } };
        await expect(findChannelRouteConfig(conn, 2)).resolves.toEqual({ handoverPoints: null });
    });

    it('findChannelRouteConfig：对象列回传直接透传', async () => {
        const hp = { R1: { name: '东门岗亭', lat: 30.1, lng: 120.2 } };
        const conn: any = { rawConnection: { query: vi.fn().mockResolvedValue([{ handoverPoints: hp }]) } };
        await expect(findChannelRouteConfig(conn, 2)).resolves.toEqual({ handoverPoints: hp });
    });

    it('findChannelRouteConfig：simple-json 字符串回传解析为对象；非法 JSON 归一为 null', async () => {
        const hp = { R1: [{ name: '东门岗亭', lat: 30.1, lng: 120.2 }] };
        const ok: any = { rawConnection: { query: vi.fn().mockResolvedValue([{ handoverPoints: JSON.stringify(hp) }]) } };
        await expect(findChannelRouteConfig(ok, 2)).resolves.toEqual({ handoverPoints: hp });
        const bad: any = { rawConnection: { query: vi.fn().mockResolvedValue([{ handoverPoints: '{oops' }]) } };
        await expect(findChannelRouteConfig(bad, 2)).resolves.toEqual({ handoverPoints: null });
    });
});
