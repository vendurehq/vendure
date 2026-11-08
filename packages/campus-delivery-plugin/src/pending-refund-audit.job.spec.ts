import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@vendure/core';

import { PendingRefundAuditJob } from './pending-refund-audit.job';

function makeJob(rows: any[]) {
    const query = vi.fn().mockResolvedValue([rows]);
    const connection = { rawConnection: { query } } as any;
    const dedupe = { seenOrMark: vi.fn().mockResolvedValue(false) } as any;
    const feishu = { pushEvent: vi.fn().mockResolvedValue(true) } as any;
    const job = new PendingRefundAuditJob(connection, dedupe, feishu);
    return { job, query, dedupe, feishu };
}

describe('PendingRefundAuditJob 待退款超 24 小时巡检', () => {
    it('捞出超期 Pending 退款单并告警，SQL 只读', async () => {
        vi.spyOn(Logger, 'warn').mockImplementation((() => undefined) as any);
        vi.spyOn(Logger, 'error').mockImplementation((() => undefined) as any);
        const createdAt = new Date(Date.now() - 30 * 3600_000).toISOString();
        const { job, query, feishu } = makeJob([
            {
                id: 8,
                total: 1200,
                createdAt,
                reason: 'group buy failed refund',
                state: 'Pending',
                method: 'wechatpay',
                orderId: 467,
                orderCode: 'T467',
            },
        ]);
        await (job as any).runOnce();

        const sql = String(query.mock.calls[0][0]);
        expect(sql).toContain("state = 'Pending'");
        expect(sql).toContain(`interval '24 hours'`);
        expect(sql).toContain('ORDER BY');
        expect(sql).not.toContain('UPDATE');

        expect(feishu.pushEvent).toHaveBeenCalledOnce();
        const [scene, title, content] = feishu.pushEvent.mock.calls[0];
        expect(scene).toBe('exception');
        expect(String(title)).toContain('超 24 小时');
        expect(String(content)).toContain('T467');
        expect(String(content)).toContain('12.00 元');
        expect(String(content)).toContain('小时');
        expect(String(content)).toContain('wechatpay');
    });

    it('没有超期退款单时不告警', async () => {
        const { job, feishu } = makeJob([]);
        await (job as any).runOnce();
        expect(feishu.pushEvent).not.toHaveBeenCalled();
    });

    it('同一退款单在告警窗口内不重复告警', async () => {
        vi.spyOn(Logger, 'warn').mockImplementation((() => undefined) as any);
        vi.spyOn(Logger, 'error').mockImplementation((() => undefined) as any);
        const { job, feishu, dedupe } = makeJob([
            { id: 8, total: 1200, createdAt: new Date().toISOString(), reason: null, state: 'Pending', method: 'wechatpay', orderId: 467, orderCode: 'T467' },
        ]);
        dedupe.seenOrMark.mockResolvedValue(true);
        await (job as any).runOnce();
        expect(dedupe.seenOrMark).toHaveBeenCalledWith('campus:pending_refund_alert:8', 6 * 3600_000);
        expect(feishu.pushEvent).not.toHaveBeenCalled();
    });
});
