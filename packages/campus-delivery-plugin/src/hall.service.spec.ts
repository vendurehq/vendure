// 预约单入厅闸门 + 放量单测（plan 3.1）
import { describe, expect, it, vi } from 'vitest';
import { Order } from '@vendure/core';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { HallService } from './hall.service';

/** customFields 字段 → 物理列名后缀（用于把 CAS 的 SET 列反解回字段名） */
const COLUMN_FIELD: Record<string, string> = Object.fromEntries(
    [
        'hallStatus', 'hallEnteredAt', 'deliveryPlan', 'handoverMode', 'thirdPartyProvider',
        'handoverPointName', 'handoverPointAddress', 'handoverPointLat', 'handoverPointLng',
        'promisedAt', 'promiseSource', 'campusCause', 'deliveryStatus', 'assignedAt',
        'deliveryStaffId', 'slotLocked',
    ].map(f => [`${f.charAt(0).toUpperCase()}${f.slice(1).toLowerCase()}`, f]),
);

function makeEnv(opts: { cfg?: any; slotLocked?: boolean; curHs?: string } = {}) {
    const updates: any[] = [];
    const orderRepo = {
        update: vi.fn().mockImplementation((_id: any, patch: any) => { updates.push(patch); return Promise.resolve({}); }),
        findOne: vi.fn().mockResolvedValue(
            opts.curHs !== undefined ? { id: 9, code: 'S1', customFields: { hallStatus: opts.curHs } } : null,
        ),
    };
    const cfgRepo = { findOne: vi.fn().mockResolvedValue(opts.cfg ?? null) };
    // 入厅/状态迁移都走裸 SQL 条件写（CAS）：把 SET 列反解成 customFields 补丁供用例断言，默认命中 1 行
    const rawQuery = vi.fn().mockImplementation((sql: string, params: any[] = []) => {
        if (sql.includes('"customFieldsHallstatus" =')) {
            const patch: Record<string, any> = {};
            for (const m of String(sql).matchAll(/"customFields([A-Za-z]+)" = \$(\d+)/g)) {
                patch[COLUMN_FIELD[m[1]] ?? m[1]] = params[Number(m[2]) - 1];
            }
            updates.push({ customFields: patch });
        }
        return Promise.resolve([[{ id: 9 }]]);
    });
    const conn = {
        getRepository: vi.fn((_ctx: any, ent: any) => {
            const name = (ent as any).name;
            if (name === 'CampusFulfillmentConfig') return cfgRepo;
            return orderRepo;
        }),
        rawConnection: { query: rawQuery },
    } as any;
    const slotLock = {
        lock: vi.fn().mockResolvedValue(opts.slotLocked ?? true),
        unlock: vi.fn().mockResolvedValue(false),
    };
    const svc = new HallService(conn, slotLock as any, { get: vi.fn() } as any, { listOnlineRiders: vi.fn().mockResolvedValue([]) } as any);
    return { svc, orderRepo, cfgRepo, updates, rawQuery, slotLock };
}

const future = (min: number) => new Date(Date.now() + min * 60_000);

describe('HallService.onOrderPlaced 预约闸门', () => {
    const base = { id: 9, code: 'S1', customFields: { fulfillmentRoute: 'R3' } };

    it('scheduledFor 距今超 30min → 挂 scheduled 暂不入厅', async () => {
        const env = makeEnv();
        const order = { ...base, customFields: { fulfillmentRoute: 'R3', scheduledFor: future(120) } };
        await env.svc.onOrderPlaced({ channelId: 1 } as any, order as any);
        expect(env.updates[0].customFields.hallStatus).toBe('scheduled');
    });

    it('锁位失败仍挂 scheduled 且带 campusCause=slot_full', async () => {
        const env = makeEnv({ slotLocked: false });
        const order = { ...base, customFields: { fulfillmentRoute: 'R3', scheduledFor: future(60) } };
        await env.svc.onOrderPlaced({ channelId: 1 } as any, order as any);
        expect(env.updates[0].customFields).toMatchObject({ hallStatus: 'scheduled', campusCause: 'slot_full' });
    });

    it('scheduledFor 距今不足 30min → 照旧即时入厅 open', async () => {
        const env = makeEnv();
        const order = { ...base, customFields: { fulfillmentRoute: 'R3', scheduledFor: future(10) } };
        await env.svc.onOrderPlaced({ channelId: 1 } as any, order as any);
        expect(env.updates[0].customFields.hallStatus).toBe('open');
        expect(env.updates[0].customFields.hallEnteredAt).toBeInstanceOf(Date);
    });

    it('无 scheduledFor（立即单）不受影响', async () => {
        const env = makeEnv({ cfg: { channelId: 1, merchantConfirmEnabled: false } });
        await env.svc.onOrderPlaced({ channelId: 1 } as any, { ...base, customFields: { fulfillmentRoute: 'R3' } } as any);
        expect(env.updates[0].customFields.hallStatus).toBe('open');
    });

    it('R1 有交接点 → pending_merchant（商户/自营先送交接点）', async () => {
        const env = makeEnv({ cfg: { channelId: 1, handoverPoints: { R1: { name: '东门岗亭', lat: 30.1, lng: 120.2 } } } });
        await env.svc.onOrderPlaced({ channelId: 1 } as any, { ...base, customFields: { fulfillmentRoute: 'R1' } } as any);
        expect(env.updates[0].customFields).toMatchObject({ hallStatus: 'pending_merchant', deliveryPlan: 'merchant' });
    });

    it('R2 有交接点 → pending_merchant（出餐闸门，出餐后才推外部快递）；快照写外部快递与交接点', async () => {
        const env = makeEnv({ cfg: { channelId: 1, handoverPoints: { R2: { name: '菜鸟驿站', lat: 30.2, lng: 120.2 } } } });
        await env.svc.onOrderPlaced({ channelId: 1 } as any, { ...base, customFields: { fulfillmentRoute: 'R2' } } as any);
        expect(env.updates[0].customFields).toMatchObject({
            hallStatus: 'pending_merchant',
            deliveryPlan: 'external_courier',
            handoverMode: 'to_campus_rider',
            handoverPointName: '菜鸟驿站',
        });
    });

    it('R2 缺交接点 → 降级传信者直送入大厅，标 no_handover_point', async () => {
        const env = makeEnv();
        await env.svc.onOrderPlaced({ channelId: 1 } as any, { ...base, customFields: { fulfillmentRoute: 'R2' } } as any);
        expect(env.updates[0].customFields).toMatchObject({
            hallStatus: 'open',
            deliveryPlan: 'campus_rider',
            campusCause: 'no_handover_point',
        });
    });

    it('R3 第一段自营快递 → owned_pool', async () => {
        const env = makeEnv({ cfg: { channelId: 1, routeFirstLeg: { R3: 'owned' } } });
        await env.svc.onOrderPlaced({ channelId: 1 } as any, { ...base, customFields: { fulfillmentRoute: 'R3' } } as any);
        expect(env.updates[0].customFields).toMatchObject({ hallStatus: 'owned_pool', deliveryPlan: 'owned' });
    });
});

describe('HallService.onOrderPlaced 取消竞态保护', () => {
    it('入厅 CAS 未命中（订单已取消/已入厅）→ 不写入任何字段并归还时段容量', async () => {
        const env = makeEnv();
        env.rawQuery.mockResolvedValueOnce([[]]);
        await env.svc.onOrderPlaced({ channelId: 1 } as any, {
            id: 9, code: 'S1', customFields: { fulfillmentRoute: 'R3' },
        } as any);
        expect(env.updates).toHaveLength(0);
        expect(env.slotLock.unlock).toHaveBeenCalledWith(expect.anything(), 9);
    });

    it('入厅 CAS 命中 → 照常写入快照与目标态', async () => {
        const env = makeEnv();
        await env.svc.onOrderPlaced({ channelId: 1 } as any, {
            id: 9, code: 'S1', customFields: { fulfillmentRoute: 'R3' },
        } as any);
        expect(env.updates[0].customFields).toMatchObject({ hallStatus: 'open' });
        expect(env.slotLock.unlock).not.toHaveBeenCalled();
    });
});

describe('HallService 承诺送达时间固化（P0 超时赔付）', () => {
    const base = { id: 9, code: 'S1', customFields: { fulfillmentRoute: 'R3' } };

    it('即时单 → 支付时间 + 店铺配送时长，source=store_minutes', async () => {
        const env = makeEnv({ cfg: { channelId: 1, deliveryMinutes: 30 } });
        const before = Date.now();
        await env.svc.onOrderPlaced({ channelId: 1 } as any, { ...base } as any);
        const cf = env.updates[0].customFields;
        expect(cf.promiseSource).toBe('store_minutes');
        expect(cf.promisedAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60_000 - 1000);
        expect(cf.promisedAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);
    });

    it('未配配送时长 → 退回 40min 默认', async () => {
        const env = makeEnv();
        await env.svc.onOrderPlaced({ channelId: 1 } as any, { ...base } as any);
        const delta = env.updates[0].customFields.promisedAt.getTime() - Date.now();
        expect(Math.round(delta / 60_000)).toBe(40);
    });

    it('预约单 → 承诺 = 时段开始 + 时段长度（按文本解析），source=slot', async () => {
        const env = makeEnv({ cfg: { channelId: 1, deliveryMinutes: 30 } });
        const start = future(120);
        const hh = (d: Date) => String(d.getHours()).padStart(2, '0');
        const mm = (d: Date) => String(d.getMinutes()).padStart(2, '0');
        const end = new Date(start.getTime() + 30 * 60_000);
        await env.svc.onOrderPlaced({ channelId: 1 } as any, {
            ...base,
            customFields: {
                fulfillmentRoute: 'R3', scheduledFor: start,
                deliverySlotText: `${hh(start)}:${mm(start)}-${hh(end)}:${mm(end)}`,
            },
        } as any);
        const cf = env.updates[0].customFields;
        expect(cf.promiseSource).toBe('slot');
        expect(Math.round((cf.promisedAt.getTime() - start.getTime()) / 60_000)).toBe(30);
    });

    it('预约单时段文本不可解析 → 退回开始 + 配送时长，source=slot_estimate', async () => {
        const env = makeEnv({ cfg: { channelId: 1, deliveryMinutes: 25 } });
        const start = future(120);
        await env.svc.onOrderPlaced({ channelId: 1 } as any, {
            ...base, customFields: { fulfillmentRoute: 'R3', scheduledFor: start, deliverySlotText: '晚间' },
        } as any);
        const cf = env.updates[0].customFields;
        expect(cf.promiseSource).toBe('slot_estimate');
        expect(Math.round((cf.promisedAt.getTime() - start.getTime()) / 60_000)).toBe(25);
    });

    it('时段文本跨零点按次日解析；异常长度视为不可解析', () => {
        expect(HallService.slotSpanMinutes('23:30-00:30')).toBe(60);
        expect(HallService.slotSpanMinutes('23:30-00:10')).toBe(40);
        expect(HallService.slotSpanMinutes('11:00-11:30')).toBe(30);
        // 超过 12h 视为脏数据（如配置错误），退回配送时长估算
        expect(HallService.slotSpanMinutes('11:00-23:30')).toBeNull();
        expect(HallService.slotSpanMinutes('晚间')).toBeNull();
    });
});

describe('HallService.releaseScheduled', () => {
    const order = { id: 9, code: 'S1', customFields: { fulfillmentRoute: 'R3' } } as unknown as Order;
    /** 断言一次 CAS 放量：从 scheduled 条件写、目标态与计时锚点 */
    const expectRelease = (env: ReturnType<typeof makeEnv>, target: string) => {
        const [sql, params] = env.rawQuery.mock.calls[0];
        expect(sql).toContain('"customFieldsHallstatus" = $2');
        expect(sql).toContain('"customFieldsHallenteredat" = $3');
        expect(sql).toContain('= ANY($4::text[])');
        expect(params).toEqual([9, target, expect.any(Date), ['scheduled']]);
    };

    it('商家确认模式 → pending_merchant', async () => {
        const env = makeEnv();
        await env.svc.releaseScheduled({ channelId: 1 } as any, order, { merchantConfirmEnabled: true } as CampusFulfillmentConfig);
        expectRelease(env, 'pending_merchant');
    });

    it('非确认模式 → 直接 open + hallEnteredAt 重置', async () => {
        const env = makeEnv();
        const released = await env.svc.releaseScheduled(
            { channelId: 1 } as any, order, { merchantConfirmEnabled: false } as CampusFulfillmentConfig,
        );
        expect(released).toBe(true);
        expectRelease(env, 'open');
    });

    it('R1 → pending_merchant；R2 → pending_merchant；R3 快照 owned → owned_pool；外部快递 → pending_dispatch', async () => {
        const env = makeEnv();
        await env.svc.releaseScheduled({ channelId: 1 } as any,
            { id: 9, code: 'S1', customFields: { fulfillmentRoute: 'R1' } } as any, null);
        expectRelease(env, 'pending_merchant');
        env.rawQuery.mockClear();
        await env.svc.releaseScheduled({ channelId: 1 } as any,
            { id: 9, code: 'S1', customFields: { fulfillmentRoute: 'R2' } } as any, null);
        expectRelease(env, 'pending_merchant');
        env.rawQuery.mockClear();
        await env.svc.releaseScheduled({ channelId: 1 } as any,
            { id: 9, code: 'S1', customFields: { fulfillmentRoute: 'R3', deliveryPlan: 'owned' } } as any, null);
        expectRelease(env, 'owned_pool');
        env.rawQuery.mockClear();
        await env.svc.releaseScheduled({ channelId: 1 } as any,
            { id: 9, code: 'S1', customFields: { fulfillmentRoute: 'R3', deliveryPlan: 'external_courier' } } as any, null);
        expectRelease(env, 'pending_dispatch');
    });

    it('并发下已非 scheduled（取消/已放量）→ CAS 不命中，返回 false', async () => {
        const env = makeEnv();
        env.rawQuery.mockResolvedValueOnce([[]]);
        const released = await env.svc.releaseScheduled(
            { channelId: 1 } as any, order, { merchantConfirmEnabled: false } as CampusFulfillmentConfig,
        );
        expect(released).toBe(false);
    });
});

describe('HallService.exitHall 取消脱厅（3.3）', () => {
    const order = { id: 9, code: 'S1' } as unknown as Order;

    it('单条条件写 → cancelled；grabbed 用 CASE 清指派字段（不覆盖 T4 终态）', async () => {
        const env = makeEnv();
        await env.svc.exitHall({ channelId: 1 } as any, order);
        expect(env.rawQuery).toHaveBeenCalledTimes(1);
        const [sql, params] = env.rawQuery.mock.calls[0];
        expect(sql).toContain(`"customFieldsHallstatus" = 'cancelled'`);
        expect(sql).toContain(`CASE WHEN "customFieldsHallstatus" = 'grabbed' THEN NULL`);
        expect(sql).toContain('"customFieldsDeliverystaffid"');
        expect(sql).toContain('"customFieldsDeliverystatus"');
        expect(sql).toContain('"customFieldsAssignedat"');
        // 仅活跃流转态可脱厅：no_rider_final / delivered 等终态不在条件里，不会被覆盖
        expect(params[1]).toContain('grabbed');
        expect(params[1]).not.toContain('no_rider_final');
        expect(params[1]).not.toContain('delivered');
        expect(env.orderRepo.update).not.toHaveBeenCalled();
    });

    it('无命中行（已终态/已取消/无记录）→ 幂等跳过不报错', async () => {
        const env = makeEnv();
        env.rawQuery.mockResolvedValueOnce([[], []]);
        await expect(env.svc.exitHall({} as any, order)).resolves.toBeUndefined();
    });

    it('refund_failed 单取消也能脱厅（否则会被退款重试任务重新捞起）', async () => {
        const env = makeEnv();
        await env.svc.exitHall({ channelId: 1 } as any, order);
        const [sql, params] = env.rawQuery.mock.calls[0];
        expect(sql).toContain(`"customFieldsHallstatus" = 'cancelled'`);
        expect(params[1]).toContain('refund_failed');
        // 终态仍不可被覆盖
        expect(params[1]).not.toContain('no_rider_final');
        expect(params[1]).not.toContain('exception_final');
        // 只在脱厅放开：回厅（backToHall）不得把退款失败单拉回大厅
        await env.svc.backToHall({ channelId: 1 } as any, 9);
        const backParams = env.rawQuery.mock.calls[1][1];
        expect(backParams[backParams.length - 1]).not.toContain('refund_failed');
    });
});

// R5 交接码一键重发：CAS 仅待交接单可重发、同单 10 分钟限流、顾客只能重发自己的单
describe('HallService.resendHandoverCode', () => {
    const ctx = { channelId: 1 } as any;

    it('待交接订单 → 生成 4 位新码并 CAS 写库（open 且非 Cancelled）', async () => {
        const env = makeEnv();
        const code = await env.svc.resendHandoverCode(ctx, 9);
        expect(code).toMatch(/^\d{4}$/);
        const call = env.rawQuery.mock.calls.find(c => String(c[0]).includes('"customFieldsHandovercode" ='));
        expect(call).toBeDefined();
        const [sql, params] = call!;
        expect(sql).toContain('"customFieldsHallstatus" = $4');
        expect(sql).toContain('"state" <> $5');
        expect(params[0]).toBe(code);
        expect(params[1]).toBeInstanceOf(Date);
        expect(params[2]).toBe(9);
        expect(params[3]).toBe('open');
        expect(params[4]).toBe('Cancelled');
    });

    it('CAS 未命中（已交接/已取消）→ 拒绝重发', async () => {
        const env = makeEnv();
        env.rawQuery.mockResolvedValueOnce([[]]);
        await expect(env.svc.resendHandoverCode(ctx, 9)).rejects.toThrow('订单当前不在待交接状态');
    });

    it('同单 10 分钟内重复重发 → 限流拒绝，不再写库', async () => {
        const env = makeEnv();
        await env.svc.resendHandoverCode(ctx, 9);
        await expect(env.svc.resendHandoverCode(ctx, 9)).rejects.toThrow('交接码重发过于频繁');
        expect(env.rawQuery.mock.calls.filter(c => String(c[0]).includes('"customFieldsHandovercode" ='))).toHaveLength(1);
    });

    it('顾客侧：订单归属本人 → 允许重发', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue({ id: 9, customer: { user: { id: 99 } } });
        const code = await env.svc.resendHandoverCodeForCustomer({ ...ctx, activeUserId: 99 }, 9);
        expect(code).toMatch(/^\d{4}$/);
    });

    it('顾客侧：订单不属于本人 → 拒绝', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue({ id: 9, customer: { user: { id: 98 } } });
        await expect(env.svc.resendHandoverCodeForCustomer({ ...ctx, activeUserId: 99 }, 9))
            .rejects.toThrow('订单不存在或不属于当前顾客');
    });

    it('顾客侧：未登录 → 拒绝', async () => {
        const env = makeEnv();
        await expect(env.svc.resendHandoverCodeForCustomer(ctx, 9)).rejects.toThrow('请先登录');
    });
});