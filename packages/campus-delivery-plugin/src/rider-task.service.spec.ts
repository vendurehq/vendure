// 纯逻辑单测：状态机（assigned 可开始 / 状态不符拒）、分成计算（100% 与 80%）、照片必传、非本骑手拒
import { describe, expect, it, vi } from 'vitest';
import { CampusDedupeService } from './campus-dedupe.service';
import { HANDOVER_CODE_TTL_MS, generateHandoverCode, isHandoverCodeExpired } from './handover-code';
import { RiderTaskService } from './rider-task.service';

/** 内存驱动去重后端（单测共享同一实例即模拟「多实例共享同一后端」） */
function memoryDedupe(): CampusDedupeService {
    return new CampusDedupeService({ rawConnection: { options: { type: 'sqlite' } } } as any);
}

function make(order: any, cfg: any = { riderCommissionRate: 100 }, feishu?: any, dedupe?: any) {
    const riderSvc = { assertApprovedRider: vi.fn().mockResolvedValue({ id: 9 }) } as any;
    const saved: any[] = [];
    // findOne 调用次序：deliver = assertOwner(查单) → getConfig(查配置)；start = assertOwner(查单)
    const repo = {
        findOne: vi.fn().mockImplementation((opts: any) =>
            opts?.where?.channelId !== undefined ? Promise.resolve(cfg) : Promise.resolve(order)),
        update: vi.fn().mockResolvedValue({}),
        save: vi.fn().mockImplementation((v: any) => {
            saved.push(v);
            // 落库后带 id（分成行 CAS 认领需要行 id）
            return Promise.resolve({ id: 501, ...v });
        }),
    };
    const rawQuery = vi.fn().mockResolvedValue([[{ id: 10 }], []]);
    const conn = {
        getRepository: () => repo,
        // deliver 原子认领（RETURNING id）：TypeORM PG query 返回 [rows, fields]
        rawConnection: { query: rawQuery },
    } as any;
    // 构造参数次序：connection / rider / credit / hall / notify / privacy / feishu（第 7 位才是飞书）/ dedupe
    return { svc: new RiderTaskService(conn, riderSvc, { adjust: vi.fn().mockResolvedValue(102) } as any, { backToHall: vi.fn() } as any, { user: vi.fn() } as any, { resolve: vi.fn() } as any, feishu, dedupe), repo, saved, rawQuery, feishu };
}

const assigned = {
    id: 10,
    code: 'A1',
    shipping: 300,
    // 分成小费以实际收取的跑腿小费 surcharge 为准（第13轮）
    surcharges: [{ description: '跑腿小费', listPrice: 100 }],
    customFields: { deliveryStaffId: '9', deliveryStatus: 'assigned', tip: 100 },
};

describe('RiderTaskService', () => {
    it('assigned 可开始配送', async () => {
        const { svc, rawQuery } = make(assigned);
        await svc.start({ channelId: 1 } as any, 10 as any);
        expect(rawQuery).toHaveBeenCalledTimes(1);
        expect(rawQuery.mock.calls[0][0]).toContain('"customFieldsDeliverystatus"');
        expect(rawQuery.mock.calls[0][1]).toEqual(['in_progress', 10, 'assigned', '9', 'grabbed']);
    });
    it('接力单交接码正确 → 可开始配送', async () => {
        const relay = { ...assigned, customFields: { ...assigned.customFields, handoverCode: '1234' } };
        const { svc, rawQuery } = make(relay);
        await svc.start({ channelId: 1 } as any, 10 as any, '1234');
        expect(rawQuery).toHaveBeenCalledTimes(1);
        expect(rawQuery.mock.calls[0][1][0]).toBe('in_progress');
    });
    it('开始配送时订单已被取消/改派（条件写未命中）→ 拒绝', async () => {
        const { svc, rawQuery } = make(assigned);
        rawQuery.mockResolvedValueOnce([[], []]);
        await expect(svc.start({ channelId: 1 } as any, 10 as any)).rejects.toThrow('订单已被取消或改派');
    });
    it('接力单交接码错误/缺失 → 拒绝开始配送', async () => {
        const relay = { ...assigned, customFields: { ...assigned.customFields, handoverCode: '1234' } };
        const { svc } = make(relay);
        await expect(svc.start({ channelId: 1 } as any, 10 as any, '9999')).rejects.toThrow('交接码不正确');
        await expect(svc.start({ channelId: 1 } as any, 10 as any)).rejects.toThrow('交接码不正确');
    });
    it('接力单交接码超过 10 分钟 → 过期拒绝', async () => {
        const relay = {
            ...assigned,
            customFields: {
                ...assigned.customFields,
                handoverCode: '1234',
                handoverCodeAt: new Date(Date.now() - 20 * 60_000),
            },
        };
        const { svc } = make(relay);
        await expect(svc.start({ channelId: 1 } as any, 10 as any, '1234')).rejects.toThrow('交接码已过期');
    });
    it('交接码有效期边界：恰好 TTL 仍有效，TTL+1ms 过期', async () => {
        vi.useFakeTimers();
        try {
            const now = new Date('2026-11-08T02:00:00.000Z');
            vi.setSystemTime(now);
            const atTtl = {
                ...assigned,
                customFields: {
                    ...assigned.customFields,
                    handoverCode: '1234',
                    handoverCodeAt: new Date(now.getTime() - HANDOVER_CODE_TTL_MS),
                },
            };
            const c1 = make(atTtl);
            await expect(c1.svc.start({ channelId: 1 } as any, 10 as any, '1234')).resolves.toBeTruthy();

            const overTtl = {
                ...assigned,
                customFields: {
                    ...assigned.customFields,
                    handoverCode: '1234',
                    handoverCodeAt: new Date(now.getTime() - HANDOVER_CODE_TTL_MS - 1),
                },
            };
            const c2 = make(overTtl);
            await expect(c2.svc.start({ channelId: 1 } as any, 10 as any, '1234')).rejects.toThrow('交接码已过期');
        } finally {
            vi.useRealTimers();
        }
    });
    it('交接码无签发时间（历史单）→ 不按过期处理', async () => {
        const legacy = { ...assigned, customFields: { ...assigned.customFields, handoverCode: '1234' } };
        const { svc } = make(legacy);
        await expect(svc.start({ channelId: 1 } as any, 10 as any, '1234')).resolves.toBeTruthy();
    });
    it('接力单交接码连续错误 5 次 → 锁定，正确码也拒绝', async () => {
        const relay = {
            ...assigned,
            customFields: { ...assigned.customFields, handoverCode: '1234', handoverCodeAt: new Date() },
        };
        const { svc } = make(relay);
        for (let i = 0; i < 5; i++) {
            await expect(svc.start({ channelId: 1 } as any, 10 as any, '9999')).rejects.toThrow('交接码不正确');
        }
        await expect(svc.start({ channelId: 1 } as any, 10 as any, '1234')).rejects.toThrow('错误次数过多');
    });
    it('多实例共享去重：失败计数跨实例累计锁止，resetHandoverGuard 可解除', async () => {
        const relay = {
            ...assigned,
            customFields: { ...assigned.customFields, handoverCode: '1234', handoverCodeAt: new Date() },
        };
        // 两个实例共享同一去重后端，模拟飞书重试落到另一实例
        const dedupe = memoryDedupe();
        const a = make(relay, undefined, undefined, dedupe);
        const b = make(relay, undefined, undefined, dedupe);
        // A 错 3 次 + B 错 2 次 → 合计 5 次，锁止
        for (let i = 0; i < 3; i++) {
            await expect(a.svc.start({ channelId: 1 } as any, 10 as any, '9999')).rejects.toThrow('交接码不正确');
        }
        for (let i = 0; i < 2; i++) {
            await expect(b.svc.start({ channelId: 1 } as any, 10 as any, '9999')).rejects.toThrow('交接码不正确');
        }
        await expect(b.svc.start({ channelId: 1 } as any, 10 as any, '1234')).rejects.toThrow('错误次数过多');
        await expect(a.svc.start({ channelId: 1 } as any, 10 as any, '1234')).rejects.toThrow('错误次数过多');
        // 重发交接码后清理（在 A 上清理，B 也应立即解除）
        await a.svc.resetHandoverGuard(10 as any);
        await expect(b.svc.start({ channelId: 1 } as any, 10 as any, '1234')).resolves.toBeTruthy();
    });
    it('delivered 需照片且分成=配送费+小费（单条原子写终态 + 认领后入账）', async () => {
        const inProg = { ...assigned, customFields: { ...assigned.customFields, deliveryStatus: 'in_progress' } };
        const { svc, saved, rawQuery } = make(inProg, { riderCommissionRate: 100 });
        await svc.deliver({ channelId: 1 } as any, 10 as any, ['p1']);
        // 第一次：认领与终态同一条 UPDATE（delivered + hallStatus + 照片 JSON + 分成 一次落库）
        // 第二次：P1 分成行 CAS 认领（pending → crediting），认领成功才入账
        expect(rawQuery).toHaveBeenCalledTimes(2);
        expect(rawQuery.mock.calls[0][0]).toContain('"customFieldsHallstatus"');
        expect(rawQuery.mock.calls[0][1]).toEqual([
            'delivered', expect.any(Date), 'delivered', JSON.stringify(['p1']), null, 400, 10, 'in_progress',
            '9', 'grabbed',
        ]);
        expect(rawQuery.mock.calls[1][0]).toContain('UPDATE rider_earning');
        expect(rawQuery.mock.calls[1][1]).toEqual(['crediting', 501, 'pending']);
        expect(saved[0].amount).toBe(400); // 300 shipping + 100 tip
    });
    it('分成落库失败（订单已送达不可重试）→ 推飞书告警人工补账', async () => {
        const inProg = { ...assigned, customFields: { ...assigned.customFields, deliveryStatus: 'in_progress' } };
        const feishu = { pushEvent: vi.fn() };
        const { svc, repo } = make(inProg, { riderCommissionRate: 100 }, feishu);
        repo.save.mockRejectedValueOnce(new Error('db down'));
        await expect(svc.deliver({ channelId: 1 } as any, 10 as any, ['p1'])).resolves.toBeTruthy();
        expect(feishu.pushEvent).toHaveBeenCalledWith(
            'alert', '骑手分成落库失败', expect.stringContaining('400'), 'A1', 'earning_persist_failed:A1',
        );
    });
    it('并发双送达/已取消 → 认领失败拒绝，不写分成（防双入账）', async () => {
        const inProg = { ...assigned, customFields: { ...assigned.customFields, deliveryStatus: 'in_progress' } };
        const { svc, saved, rawQuery } = make(inProg);
        rawQuery.mockResolvedValueOnce([[], []]);
        await expect(svc.deliver({ channelId: 1 } as any, 10 as any, ['p1'])).rejects.toThrow('订单已被取消或处理');
        expect(rawQuery.mock.calls[0][0]).toContain(`"state" <> 'Cancelled'`);
        expect(saved).toHaveLength(0);
    });
    it('分成比例 80%', async () => {
        const inProg = { ...assigned, customFields: { ...assigned.customFields, deliveryStatus: 'in_progress' } };
        const { svc, saved } = make(inProg, { riderCommissionRate: 80 });
        await svc.deliver({ channelId: 1 } as any, 10 as any, ['p1']);
        expect(saved[0].amount).toBe(320);
    });
    it('小费未实际收取（无 surcharge）→ 分成只按运费计，tip 记 0（防分成虚高）', async () => {
        // customFields.tip=100 但小费 surcharge 未落库（errand 写入失败）：不得按 cf.tip 多发分成
        const inProg = {
            ...assigned,
            surcharges: [],
            customFields: { ...assigned.customFields, deliveryStatus: 'in_progress' },
        };
        const { svc, saved } = make(inProg, { riderCommissionRate: 100 });
        await svc.deliver({ channelId: 1 } as any, 10 as any, ['p1']);
        expect(saved[0].amount).toBe(300);
        expect(saved[0].tip).toBe(0);
    });
    it('无照片拒单', async () => {
        const inProg = { ...assigned, customFields: { ...assigned.customFields, deliveryStatus: 'in_progress' } };
        const { svc } = make(inProg);
        await expect(svc.deliver({ channelId: 1 } as any, 10 as any, [])).rejects.toThrow('送达需至少一张照片');
    });
    it('非本骑手拒', async () => {
        const other = { ...assigned, customFields: { deliveryStaffId: '8', deliveryStatus: 'assigned' } };
        const { svc } = make(other);
        await expect(svc.start({ channelId: 1 } as any, 10 as any)).rejects.toThrow();
    });
    it('0 分成单（0 运费 0 小费）不入账不写 earning 且不抛错', async () => {
        const zero = { id: 11, code: 'A2', shipping: 0, customFields: { deliveryStaffId: '9', deliveryStatus: 'in_progress', tip: 0 } };
        const { svc, saved } = make(zero, { riderCommissionRate: 80 });
        const order = await svc.deliver({ channelId: 1 } as any, 11 as any, ['p1']);
        expect(order).toBeTruthy();
        expect(saved).toHaveLength(0); // 未写 RiderEarning
    });
    it('有运费但分成 0（rate=0）也跳过入账（0 金额 pending 会触发余额端口报错）', async () => {
        const inProg = { ...assigned, customFields: { ...assigned.customFields, deliveryStatus: 'in_progress' } };
        const { svc, saved } = make(inProg, { riderCommissionRate: 0 });
        await svc.deliver({ channelId: 1 } as any, 10 as any, ['p1']);
        expect(saved).toHaveLength(0);
    });
    it('大厅阶段（尚无 deliveryStatus）也可催单', async () => {
        const hallOrder = {
            id: 12, code: 'A3', shipping: 0,
            customFields: { hallStatus: 'open' },
            customer: { user: { id: 5 } },
        };
        const { svc, repo } = make(hallOrder);
        await svc.urgeOrder({ channelId: 1, activeUserId: 5 } as any, 12 as any);
        expect(repo.update).toHaveBeenCalledWith(12, expect.objectContaining({
            customFields: expect.objectContaining({ urged: true }),
        }));
    });
    it('已送达终态 → 拒绝催单', async () => {
        const done = {
            id: 13, code: 'A4', shipping: 0,
            customFields: { hallStatus: 'delivered', deliveryStatus: 'delivered' },
            customer: { user: { id: 5 } },
        };
        const { svc } = make(done);
        await expect(svc.urgeOrder({ channelId: 1, activeUserId: 5 } as any, 13 as any)).rejects.toThrow('当前状态无需催单');
    });
    it('非配送中状态（已送达）上报异常 → 拒绝', async () => {
        const done = { ...assigned, customFields: { ...assigned.customFields, deliveryStatus: 'delivered' } };
        const { svc } = make(done);
        await expect(svc.reportException({ channelId: 1 } as any, 10 as any, 'food_spilled', ['p1']))
            .rejects.toThrow('当前状态不允许上报异常');
    });
    it('配送中上报异常 → 条件写 exception（含骑手归属与未取消守卫）', async () => {
        const inProg = { ...assigned, customFields: { ...assigned.customFields, deliveryStatus: 'in_progress' } };
        const { svc, rawQuery } = make(inProg);
        await svc.reportException({ channelId: 1 } as any, 10 as any, 'food_spilled', ['p1'], '洒漏');
        expect(rawQuery).toHaveBeenCalledTimes(1);
        const [sql, params] = rawQuery.mock.calls[0];
        expect(sql).toContain('"customFieldsExceptiontype"');
        expect(sql).toContain(`"state" <> 'Cancelled'`);
        expect(params).toEqual([
            'exception', 'food_spilled', JSON.stringify(['p1']), '洒漏', expect.any(Date), 10, ['assigned', 'in_progress'], '9',
        ]);
    });
    it('上报异常时订单已被取消/改派（条件写未命中）→ 拒绝', async () => {
        const inProg = { ...assigned, customFields: { ...assigned.customFields, deliveryStatus: 'in_progress' } };
        const { svc, rawQuery } = make(inProg);
        rawQuery.mockResolvedValueOnce([[], []]);
        await expect(svc.reportException({ channelId: 1 } as any, 10 as any, 'food_spilled', ['p1']))
            .rejects.toThrow('订单已被取消或改派');
    });
});

describe('handover-code 共享规则（A2/A3）', () => {
    it('generateHandoverCode：始终是 4 位数字（1000–9999）', () => {
        const lo = vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            expect(generateHandoverCode()).toBe('1000');
        } finally {
            lo.mockRestore();
        }
        const hi = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            const code = generateHandoverCode();
            expect(code).toMatch(/^\d{4}$/);
            expect(Number(code)).toBeLessThanOrEqual(9999);
        } finally {
            hi.mockRestore();
        }
    });

    it('isHandoverCodeExpired：支持 Date / 毫秒数 / ISO 字符串，无时间戳不过期', () => {
        const t = new Date('2026-11-08T02:00:00.000Z');
        expect(isHandoverCodeExpired(null, t.getTime() + 60_000)).toBe(false);
        expect(isHandoverCodeExpired(undefined, t.getTime() + 60_000)).toBe(false);
        expect(isHandoverCodeExpired(t, t.getTime() + 60_000)).toBe(false);
        expect(isHandoverCodeExpired(t.toISOString(), t.getTime() + 60_000)).toBe(false);
        expect(isHandoverCodeExpired(t.getTime(), t.getTime() + 60_000)).toBe(false);
        expect(isHandoverCodeExpired(t, t.getTime() + HANDOVER_CODE_TTL_MS)).toBe(false);
        expect(isHandoverCodeExpired(t, t.getTime() + HANDOVER_CODE_TTL_MS + 1)).toBe(true);
        expect(isHandoverCodeExpired(t.toISOString(), t.getTime() + HANDOVER_CODE_TTL_MS + 1)).toBe(true);
    });
});
