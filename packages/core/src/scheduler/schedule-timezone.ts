import type { SchedulerOptions } from '../config/vendure-config';
import type { ScheduledTask } from './scheduled-task';

/**
 * Resolves the effective timezone in which a scheduled task's cron schedule should be
 * evaluated: a task-level `timezone` takes precedence over the global
 * `schedulerOptions.timezone`. Blank values (empty or whitespace-only strings, e.g. from
 * a defined-but-empty environment variable) are treated as "not set". When no timezone
 * is set, `undefined` is returned, which causes cron expressions to be evaluated in the
 * timezone of the Node.js process, preserving the behaviour of versions prior to the
 * introduction of this option.
 *
 * This helper is intentionally the single source of truth for timezone resolution. It is
 * used both when constructing the cron job in the {@link SchedulerService} and when
 * computing the schedule interval in the `StaleTaskService`, so that the two can never
 * disagree about when a task is due to run.
 */
export function getScheduleTimezone(
    task: ScheduledTask,
    schedulerOptions: Pick<SchedulerOptions, 'timezone'>,
): string | undefined {
    const taskTimezone = task.options.timezone;
    const timezone = taskTimezone?.trim() ? taskTimezone : schedulerOptions.timezone;
    return timezone?.trim() ? timezone : undefined;
}

/**
 * Asserts that the given string is a timezone identifier understood by the runtime.
 * croner does reject invalid timezones on its own (a TypeError thrown from the `Cron`
 * constructor), but its message cannot name the Vendure task that carries the bad
 * value. Checking here lets the failure point at the offending task id.
 */
export function assertValidTimezone(timezone: string, taskId: string): void {
    try {
        // Intl throws a RangeError for unknown timezone identifiers.
        // eslint-disable-next-line no-new
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch (e: any) {
        throw new Error(
            `Invalid timezone "${timezone}" configured for scheduled task "${taskId}". ` +
                `The value must be a timezone identifier accepted by the Intl API, ` +
                `e.g. "Europe/Stockholm" or "UTC".`,
        );
    }
}
