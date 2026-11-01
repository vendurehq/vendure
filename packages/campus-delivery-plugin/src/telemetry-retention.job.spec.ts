import { describe, expect, it, vi } from 'vitest';
import { TELEMETRY_RETENTION_DAYS, TelemetryRetentionJob } from './telemetry-retention.job';

const DAY_MS = 24 * 3600_000;

/** 过期清理：分批删除，直到无旧行 */
function makeEnv(opts: { batches?: Record<string, number[]>; failTable?: string } = {}) {
    const calls: Array<{ sql: string; params: any[] }> = [];
    const cursor: Record<string, number> = {};
    const query = vi.fn(async (sql: string, params: any[]) => {
        calls.push({ sql, params });
        const table = sql.includes('campus_track_event') ? 'campus_track_event' : 'campus_error_report';
        if (opts.failTable === table) throw new Error('boom');
        const batches = opts.batches?.[table] ?? [1];
        const i = cursor[table] ?? 0;
        cursor[table] = i + 1;
        const n = i < batches.length ? batches[i] : 0;
        return Array.from({ length: n }, (_, k) => ({ id: k }));
    });
    const svc = new TelemetryRetentionJob({ rawConnection: { query } } as any);
    return { svc, calls, query };
}

describe('TelemetryRetentionJob.run', () => {
    it('按保留期分批删除两张表，空批后停止', async () => {
        const { svc, calls } = makeEnv({ batches: { campus_track_event: [2, 2], campus_error_report: [1] } });
        await svc.run();
        // 每表：1~N 个非空批 + 1 个空批收尾
        expect(calls.filter(c => c.sql.includes('campus_track_event'))).toHaveLength(3);
        expect(calls.filter(c => c.sql.includes('campus_error_report'))).toHaveLength(2);
        const cutoff = calls[0].params[0] as Date;
        expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(TELEMETRY_RETENTION_DAYS * DAY_MS - 60_000);
        expect(calls[0].sql).toContain('RETURNING id');
    });

    it('单表清理失败不影响另一张表', async () => {
        const { svc, calls } = makeEnv({ failTable: 'campus_track_event' });
        await expect(svc.run()).resolves.toBeUndefined();
        expect(calls.some(c => c.sql.includes('campus_error_report'))).toBe(true);
    });

    it('无过期数据时不执行删除（只查一轮空批）', async () => {
        const { svc, calls } = makeEnv({ batches: { campus_track_event: [0], campus_error_report: [0] } });
        await svc.run();
        expect(calls).toHaveLength(2);
    });
});
