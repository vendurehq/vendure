// §54.6 骑手合规到期提醒单测：命中 30 天窗口/已过期才发站内信，且同一骑手当天不重复发
import { describe, expect, it, vi } from 'vitest';
import { RiderComplianceReminderJob } from './rider-compliance-reminder.job';

const DAY = 86400_000;

function make(opts?: { riders?: any[]; seen?: any[] }) {
    const saved: { entity: string; value: any }[] = [];
    const query = vi.fn(async (sql: string) => {
        if (sql.includes('FROM customer c')) return opts?.riders ?? [];
        if (sql.includes('FROM message_delivery')) return opts?.seen ?? [];
        return [];
    });
    const getRepository = vi.fn((_ctx: any, entity: any) => ({
        create: (v: any) => v,
        save: vi.fn(async (v: any) => {
            saved.push({ entity: String(entity), value: v });
            return { ...v, id: saved.length };
        }),
    }));
    const connection: any = {
        rawConnection: {
            query,
            getRepository: () => ({ findOne: async () => ({ id: 2, code: 'campus' }) }),
        },
        getRepository,
    };
    return { job: new RiderComplianceReminderJob(connection), saved, query };
}

/** 健康证距今天 days 天（负数=已过期） */
function rider(days: number, extra?: Record<string, any>) {
    return {
        customerId: 55,
        channelId: 2,
        healthCertNo: 'HC-001',
        healthCertImg: null,
        healthCertExpiry: new Date(Date.now() + days * DAY).toISOString(),
        insuranceNo: null,
        insuranceExpiry: null,
        backgroundCheck: 'passed',
        ...extra,
    };
}

describe('RiderComplianceReminderJob', () => {
    it('健康证进入 30 天窗口 → 发一条站内信（含剩余天数）', async () => {
        const { job, saved } = make({ riders: [rider(10)] });
        await job.runOnce();
        const msg = saved.find(s => s.entity === 'Message')?.value;
        expect(msg?.title).toBe('骑手合规到期提醒');
        expect(msg?.body).toContain('健康证将于');
        expect(msg?.body).toContain('剩 10 天');
        expect(saved.find(s => s.entity === 'MessageDelivery')?.value.deliveryStatus).toBe('sent');
    });

    it('健康证已过期 → 文案为「已过期」', async () => {
        const { job, saved } = make({ riders: [rider(-3)] });
        await job.runOnce();
        expect(saved[0].value.body).toContain('已于');
        expect(saved[0].value.body).toContain('过期');
    });

    it('当天已收到同标题站内信 → 本轮跳过（每人每天一条）', async () => {
        const { job, saved } = make({ riders: [rider(10)], seen: [{ hit: 1 }] });
        await job.runOnce();
        expect(saved).toHaveLength(0);
    });

    it('距到期超过 30 天 → 不提醒，也不查去重', async () => {
        const { job, saved, query } = make({ riders: [rider(100)] });
        await job.runOnce();
        expect(saved).toHaveLength(0);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('无已审核骑手 → 直接返回', async () => {
        const { job, saved } = make({ riders: [] });
        await job.runOnce();
        expect(saved).toHaveLength(0);
    });

    it('保险到期同样命中提醒', async () => {
        const { job, saved } = make({
            riders: [rider(200, { insuranceNo: 'IN-001', insuranceExpiry: new Date(Date.now() + 5 * DAY).toISOString() })],
        });
        await job.runOnce();
        expect(saved[0].value.body).toContain('保险将于');
    });
});
