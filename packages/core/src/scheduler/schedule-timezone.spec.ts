import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from './scheduled-task';

import { assertValidTimezone, getScheduleTimezone } from './schedule-timezone';

function createTask(timezone?: string) {
    // A stub is used rather than a real ScheduledTask instance to keep this
    // spec free of the service imports that the ScheduledTask module pulls in.
    return { id: 'test-task', options: { schedule: '0 2 * * *', timezone } } as unknown as ScheduledTask;
}

describe('getScheduleTimezone()', () => {
    it('returns undefined when neither task nor global timezone is set', () => {
        expect(getScheduleTimezone(createTask(), {})).toBeUndefined();
    });

    it('falls back to the global timezone', () => {
        expect(getScheduleTimezone(createTask(), { timezone: 'Europe/Stockholm' })).toBe('Europe/Stockholm');
    });

    it('task-level timezone takes precedence over the global timezone', () => {
        expect(getScheduleTimezone(createTask('America/New_York'), { timezone: 'Europe/Stockholm' })).toBe(
            'America/New_York',
        );
    });

    it('uses the task-level timezone when no global timezone is set', () => {
        expect(getScheduleTimezone(createTask('America/New_York'), {})).toBe('America/New_York');
    });

    it('treats a blank task-level timezone as unset and falls back to the global timezone', () => {
        expect(getScheduleTimezone(createTask(''), { timezone: 'Europe/Stockholm' })).toBe(
            'Europe/Stockholm',
        );
    });

    it('treats a blank global timezone as unset', () => {
        expect(getScheduleTimezone(createTask(), { timezone: '' })).toBeUndefined();
        expect(getScheduleTimezone(createTask('   '), { timezone: ' ' })).toBeUndefined();
    });
});

describe('assertValidTimezone()', () => {
    it('accepts valid IANA timezone identifiers', () => {
        expect(() => assertValidTimezone('UTC', 'test-task')).not.toThrow();
        expect(() => assertValidTimezone('Europe/Stockholm', 'test-task')).not.toThrow();
        expect(() => assertValidTimezone('America/New_York', 'test-task')).not.toThrow();
    });

    it('throws an error naming the task and the invalid value', () => {
        expect(() => assertValidTimezone('Not/AZone', 'my-task')).toThrowError(
            /Invalid timezone "Not\/AZone" configured for scheduled task "my-task"/,
        );
    });
});
