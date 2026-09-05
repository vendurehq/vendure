import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `default-config` must be evaluated before the ScheduledTask module chain,
// because it instantiates ScheduledTask at module scope and the ScheduledTask
// module's own imports lead back into the config module. This mirrors the
// load order of the package entry point. Type-only imports are elided at
// runtime, so a side-effect import is required.
import '../../config/default-config';

import type { ConfigService } from '../../config/config.service';
import type { TransactionalConnection } from '../../connection/transactional-connection';

import { ScheduledTask } from '../../scheduler/scheduled-task';

import { StaleTaskService } from './stale-task.service';

function createService(globalTimezone?: string) {
    const configService = {
        schedulerOptions: {
            timezone: globalTimezone,
        },
    } as unknown as ConfigService;
    return new StaleTaskService({} as TransactionalConnection, configService);
}

function createTask(id: string, schedule: string, timezone?: string) {
    return new ScheduledTask({
        id,
        schedule,
        timezone,
        execute: () => Promise.resolve(),
    });
}

describe('StaleTaskService.getScheduleIntervalMs()', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // The day before the DST fall-back transition in Europe/Stockholm
        // (2025-10-26, 03:00 CEST -> 02:00 CET).
        vi.setSystemTime(new Date('2025-10-24T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('computes the interval in the configured timezone across a DST transition', () => {
        const service = createService('Europe/Stockholm');
        const task = createTask('dst-task', '0 4 * * *');
        // 04:00 CEST on Oct 25 to 04:00 CET on Oct 26 is 25 hours
        expect(service.getScheduleIntervalMs(task)).toBe(25 * 60 * 60 * 1000);
    });

    it('computes a fixed interval in UTC across the same dates', () => {
        const service = createService('UTC');
        const task = createTask('utc-task', '0 4 * * *');
        expect(service.getScheduleIntervalMs(task)).toBe(24 * 60 * 60 * 1000);
    });

    it('task-level timezone takes precedence over the global timezone', () => {
        const service = createService('UTC');
        const task = createTask('override-task', '0 4 * * *', 'Europe/Stockholm');
        expect(service.getScheduleIntervalMs(task)).toBe(25 * 60 * 60 * 1000);
    });

    it('computes the interval in the process timezone when no timezone is configured', () => {
        // A mid-January date, far from any DST transition, so the 24h
        // expectation holds in every process timezone.
        vi.setSystemTime(new Date('2026-01-07T12:00:00Z'));
        const service = createService();
        const task = createTask('no-tz-task', '0 4 * * *');
        expect(service.getScheduleIntervalMs(task)).toBe(24 * 60 * 60 * 1000);
    });
});
