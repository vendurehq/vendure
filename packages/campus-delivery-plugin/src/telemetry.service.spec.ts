import { describe, expect, it, vi } from 'vitest';
import { TelemetryService, TRACK_DAILY_MAX_PER_CHANNEL, ERROR_DAILY_MAX_PER_CHANNEL } from './telemetry.service';

/** 每日预算（M2）：公开埋点/错误上报除进程内限流外的跨实例兜底 */
function makeEnv(opts: { rowsToday?: number; dup?: number } = {}) {
    const qb: any = {
        where: vi.fn(() => qb),
        andWhere: vi.fn(() => qb),
        getCount: vi.fn().mockResolvedValue(opts.dup ?? 0),
    };
    const repo = {
        count: vi.fn().mockResolvedValue(opts.rowsToday ?? 0),
        save: vi.fn(async (rows: any) => rows),
        createQueryBuilder: vi.fn(() => qb),
    };
    const conn = { getRepository: vi.fn(() => repo) } as any;
    return { svc: new TelemetryService(conn), repo };
}

const ctx = {
    channelId: 7,
    activeUserId: undefined,
    req: { headers: { 'user-agent': 'ut' }, ip: '10.0.0.1' },
} as any;

const events = (n: number) => ({
    events: Array.from({ length: n }, (_, i) => ({ eventName: `e${i}`, page: '/p' })),
});

describe('TelemetryService 每日写入预算', () => {
    it('未达上限时正常入库并返回条数', async () => {
        const { svc, repo } = makeEnv({ rowsToday: 100 });
        await expect(svc.trackEvents(ctx, events(3))).resolves.toBe(3);
        expect(repo.save).toHaveBeenCalled();
    });

    it('当日已入库达到上限 → 丢弃本次上报、不写库', async () => {
        const { svc, repo } = makeEnv({ rowsToday: TRACK_DAILY_MAX_PER_CHANNEL });
        await expect(svc.trackEvents(ctx, events(5))).resolves.toBe(0);
        expect(repo.save).not.toHaveBeenCalled();
    });

    it('批量按实际条数扣减预算：临界批次写满后，下一次即被丢弃', async () => {
        const { svc, repo } = makeEnv({ rowsToday: TRACK_DAILY_MAX_PER_CHANNEL - 6 });
        // 6 条刚好用完预算，仍应入库
        await expect(svc.trackEvents(ctx, events(6))).resolves.toBe(6);
        expect(repo.save).toHaveBeenCalledTimes(1);
        // 预算已满（60s 内不再回查 DB），后续直接丢弃
        await expect(svc.trackEvents(ctx, events(1))).resolves.toBe(0);
        expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('错误上报超预算 → 返回 false 且不写库', async () => {
        const { svc, repo } = makeEnv({ rowsToday: ERROR_DAILY_MAX_PER_CHANNEL });
        await expect(svc.reportError(ctx, { message: 'boom' })).resolves.toBe(false);
        expect(repo.save).not.toHaveBeenCalled();
    });

    it('错误上报在预算内 → 写库并返回 true', async () => {
        const { svc, repo } = makeEnv({ rowsToday: 10, dup: 0 });
        await expect(svc.reportError(ctx, { message: 'boom', source: 'admin', level: 'warn' })).resolves.toBe(true);
        expect(repo.save).toHaveBeenCalledTimes(1);
    });
});
