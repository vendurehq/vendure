// L2 定时任务统一咨询锁：拿不到锁则本轮跳过，拿到锁才执行（且锁 key 命名统一为 campus:<任务名>）
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AfterSalesFollowUpRemindJob } from './after-sales-followup-remind.job';
import { AfterSalesSlaAlertJob } from './after-sales-sla-alert.job';
import { AfterSalesSlaDeadlineJob } from './after-sales-sla-deadline.job';
import { WithdrawReconcileJob } from './withdraw-reconcile.job';

function makeConn(lockOk: boolean) {
    const runner = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn(async (sql: string) => {
            if (sql.includes('pg_try_advisory_lock')) return [[{ ok: lockOk }], []];
            return [];
        }),
        release: vi.fn().mockResolvedValue(undefined),
    };
    const rawQuery = vi.fn(async () => []);
    const find = vi.fn(async () => []);
    const rawConnection = {
        query: rawQuery,
        createQueryRunner: () => runner,
        getRepository: () => ({ find }),
    };
    return { connection: { rawConnection } as any, rawQuery, find, runner };
}

/** 断言本轮确实尝试过指定 key 的咨询锁 */
function expectLockKey(runner: ReturnType<typeof makeConn>['runner'], key: string) {
    const call = runner.query.mock.calls.find((c: any[]) => String(c[0]).includes('pg_try_advisory_lock'));
    expect(call).toBeTruthy();
    expect((call as any[])[1]).toEqual([key]);
}

describe('定时任务统一咨询锁（M5a/L2）', () => {
    afterEach(() => vi.useRealTimers());

    it('withdraw-reconcile：抢到锁跑对账，抢不到跳过', async () => {
        vi.useFakeTimers();
        const reconcile = vi.fn().mockResolvedValue(undefined);

        const ok = makeConn(true);
        const j1 = new WithdrawReconcileJob({ reconcileWithdrawIntents: reconcile } as any, ok.connection);
        j1.start();
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(reconcile).toHaveBeenCalledTimes(1);
        expectLockKey(ok.runner, 'campus:withdraw-reconcile');
        j1.onApplicationShutdown();

        reconcile.mockClear();
        const busy = makeConn(false);
        const j2 = new WithdrawReconcileJob({ reconcileWithdrawIntents: reconcile } as any, busy.connection);
        j2.start();
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(reconcile).not.toHaveBeenCalled();
        j2.onApplicationShutdown();
    });

    it('after-sales-followup-remind：抢到锁扫回访，抢不到跳过', async () => {
        vi.useFakeTimers();
        const ok = makeConn(true);
        const j1 = new AfterSalesFollowUpRemindJob(ok.connection, { publish: vi.fn() } as any);
        j1.start();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(ok.rawQuery).toHaveBeenCalledTimes(1);
        expectLockKey(ok.runner, 'campus:after-sales-followup-remind');
        j1.stop();

        const busy = makeConn(false);
        const j2 = new AfterSalesFollowUpRemindJob(busy.connection, { publish: vi.fn() } as any);
        j2.start();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(busy.rawQuery).not.toHaveBeenCalled();
        j2.stop();
    });

    it('after-sales-sla-alert：抢到锁扫 SLA，抢不到跳过', async () => {
        vi.useFakeTimers();
        const ok = makeConn(true);
        const j1 = new AfterSalesSlaAlertJob(ok.connection, { publish: vi.fn() } as any);
        j1.start();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(ok.rawQuery).toHaveBeenCalledTimes(1);
        expectLockKey(ok.runner, 'campus:after-sales-sla-alert');
        j1.stop();

        const busy = makeConn(false);
        const j2 = new AfterSalesSlaAlertJob(busy.connection, { publish: vi.fn() } as any);
        j2.start();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(busy.rawQuery).not.toHaveBeenCalled();
        j2.stop();
    });

    it('after-sales-sla-deadline：抢到锁重算，抢不到跳过', async () => {
        vi.useFakeTimers();
        const config = { getConfig: vi.fn(async () => null) } as any;

        const ok = makeConn(true);
        const j1 = new AfterSalesSlaDeadlineJob(ok.connection, config);
        j1.start();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(ok.find).toHaveBeenCalledTimes(1);
        expectLockKey(ok.runner, 'campus:after-sales-sla-deadline');
        j1.stop();

        const busy = makeConn(false);
        const j2 = new AfterSalesSlaDeadlineJob(busy.connection, config);
        j2.start();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(busy.find).not.toHaveBeenCalled();
        j2.stop();
    });
});
