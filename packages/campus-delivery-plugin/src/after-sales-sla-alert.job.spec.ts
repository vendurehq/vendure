// §125 售后 SLA 提醒：阈值改从渠道实体读，超时/临期各提醒一次，抢占失败不重复推送
import { describe, expect, it, vi } from 'vitest';

import { AfterSalesSlaAlertJob } from './after-sales-sla-alert.job';

const HOUR = 3600_000;

function make(opts: {
    rows?: any[];
    claimOk?: boolean;
    channel?: any;
} = {}) {
    const rows = opts.rows ?? [];
    const claimOk = opts.claimOk ?? true;
    const rawQuery = vi.fn(async (sql: string) => {
        if (sql.includes('FROM after_sales_request')) return [[...rows], []];
        if (sql.includes('INSERT INTO campus_after_sales_sla_alert')) {
            return claimOk ? [[{ requestId: 1 }], []] : [[], []];
        }
        return [];
    });
    const findOne = vi.fn(async () => (
        opts.channel === null
            ? null
            : (opts.channel ?? { id: 1, code: 'campus', customFields: { afterSalesTimeoutHours: 48, afterSalesDueSoonHours: 12 } })
    ));
    const rawConnection = { query: rawQuery, getRepository: () => ({ findOne }) };
    const publish = vi.fn();
    const job = new AfterSalesSlaAlertJob({ rawConnection } as any, { publish } as any);
    return { job, rawQuery, findOne, publish };
}

/** 单条待处理售后：createdAt = 现在 - hoursAgo 小时 */
function pending(hoursAgo: number, requestId = 1, pausedMs = 0) {
    return {
        requestId,
        channelId: 1,
        // createdAt 是 DB now() 写入的 UTC 墙钟：造数模拟 pg 读回（本地字段 = UTC 墙钟）
        createdAt: new Date(Date.now() - hoursAgo * HOUR),
        slaPausedMs: pausedMs,
    };
}

describe('AfterSalesSlaAlertJob', () => {
    it('超过处理时限 → 发「售后已超时」且正文带时限小时数', async () => {
        const { job, publish } = make({ rows: [pending(60)] });
        await job.runOnce();
        expect(publish).toHaveBeenCalledTimes(1);
        const evt: any = publish.mock.calls[0][0];
        expect(evt.title).toBe('售后已超时');
        expect(evt.content).toContain('48 小时');
        expect(evt.requestId).toBe(1);
    });

    it('进入临期窗口 → 发「售后即将超时」', async () => {
        const { job, publish } = make({ rows: [pending(40)] });
        await job.runOnce();
        expect(publish).toHaveBeenCalledTimes(1);
        expect((publish.mock.calls[0][0] as any).title).toBe('售后即将超时');
    });

    it('临期阈值配 0（关闭）→ 临近截止也不提醒', async () => {
        const { job, publish, rawQuery } = make({
            rows: [pending(40)],
            channel: { id: 1, code: 'campus', customFields: { afterSalesTimeoutHours: 48, afterSalesDueSoonHours: 0 } },
        });
        await job.runOnce();
        expect(publish).not.toHaveBeenCalled();
        expect(rawQuery.mock.calls.some(c => String(c[0]).includes('INSERT INTO campus_after_sales_sla_alert'))).toBe(false);
    });

    it('未进窗口 → 既不报也不抢占', async () => {
        const { job, publish, rawQuery } = make({ rows: [pending(20)] });
        await job.runOnce();
        expect(publish).not.toHaveBeenCalled();
        expect(rawQuery.mock.calls.some(c => String(c[0]).includes('INSERT INTO campus_after_sales_sla_alert'))).toBe(false);
    });

    it('暂停累计顺延截止时间（§95）→ 暂停 30h 后既不算超时也还没进临期窗', async () => {
        const { job, publish } = make({ rows: [pending(60, 1, 30 * HOUR)] });
        await job.runOnce();
        expect(publish).not.toHaveBeenCalled();
    });

    it('抢占失败（24h 内已提醒过）→ 不重复推送', async () => {
        const { job, publish } = make({ rows: [pending(60)], claimOk: false });
        await job.runOnce();
        expect(publish).not.toHaveBeenCalled();
    });

    it('渠道不存在 → 跳过该单', async () => {
        const { job, publish } = make({ rows: [pending(60)], channel: null });
        await job.runOnce();
        expect(publish).not.toHaveBeenCalled();
    });

    it('未配置阈值 → 按默认 48h / 12h', async () => {
        const { job, publish } = make({
            rows: [pending(60)],
            channel: { id: 1, code: 'campus', customFields: {} },
        });
        await job.runOnce();
        expect(publish).toHaveBeenCalledTimes(1);
        expect((publish.mock.calls[0][0] as any).content).toContain('48 小时');
    });

    it('同一渠道多单 → 渠道只查一次', async () => {
        const { job, findOne } = make({ rows: [pending(60, 1), pending(60, 2)] });
        await job.runOnce();
        expect(findOne).toHaveBeenCalledTimes(1);
    });

    it('查询失败（表/列缺失）→ 本轮跳过且不抛错', async () => {
        const rawQuery = vi.fn(async (sql: string) => {
            if (sql.includes('FROM after_sales_request')) throw new Error('column does not exist');
            return [];
        });
        const rawConnection = { query: rawQuery, getRepository: () => ({ findOne: vi.fn() }) };
        const job = new AfterSalesSlaAlertJob({ rawConnection } as any, { publish: vi.fn() } as any);
        await expect(job.runOnce()).resolves.toBeUndefined();
    });
});
