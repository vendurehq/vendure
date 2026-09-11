import { describe, expect, it } from 'vitest';

import { assertValidTimezones, getScheduleTimezone } from './schedule-timezone';

type TaskArg = Parameters<typeof getScheduleTimezone>[0];

function createTask(timezone?: string) {
    // A stub is used rather than a real ScheduledTask instance to keep this
    // spec free of the service imports that the ScheduledTask module pulls in.
    return { id: 'test-task', options: { schedule: '0 2 * * *', timezone } } as unknown as TaskArg;
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

    it('trims surrounding whitespace', () => {
        expect(getScheduleTimezone(createTask(' Europe/Stockholm '), {})).toBe('Europe/Stockholm');
        expect(getScheduleTimezone(createTask(), { timezone: ' Europe/Stockholm ' })).toBe(
            'Europe/Stockholm',
        );
    });
});

describe('assertValidTimezones()', () => {
    it('accepts valid IANA timezone identifiers', () => {
        expect(() =>
            assertValidTimezones({
                timezone: 'UTC',
                tasks: [createTask('Europe/Stockholm'), createTask('America/New_York')],
            }),
        ).not.toThrow();
    });

    it('accepts blank and absent identifiers', () => {
        expect(() => assertValidTimezones({})).not.toThrow();
        expect(() => assertValidTimezones({ timezone: '  ', tasks: [createTask('')] })).not.toThrow();
    });

    it('names the global option when the global timezone is invalid', () => {
        expect(() => assertValidTimezones({ timezone: 'Not/AZone', tasks: [createTask()] })).toThrowError(
            /Invalid timezone "Not\/AZone" configured for the `schedulerOptions.timezone` option/,
        );
    });

    it('validates the global timezone even when no tasks are configured', () => {
        expect(() => assertValidTimezones({ timezone: 'Not/AZone' })).toThrowError(/Invalid timezone/);
    });

    it('names the task when a task timezone is invalid', () => {
        expect(() =>
            assertValidTimezones({ timezone: 'UTC', tasks: [createTask('Not/AZone')] }),
        ).toThrowError(/Invalid timezone "Not\/AZone" configured for the scheduled task "test-task"/);
    });
});
