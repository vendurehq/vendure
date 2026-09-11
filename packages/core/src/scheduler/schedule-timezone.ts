import type { ScheduledTask } from './scheduled-task';

/**
 * Resolves the timezone in which a task's cron schedule is evaluated. A task-level
 * `timezone` takes precedence over the global `schedulerOptions.timezone`, and blank
 * values are treated as unset. Returning `undefined` makes croner evaluate the
 * schedule in the timezone of the Node.js process.
 *
 * This is the single source of truth for the resolution, used both when constructing
 * the cron job in the {@link SchedulerService} and when computing the schedule interval
 * in the `StaleTaskService`, so that the two cannot disagree about when a task is due.
 */
export function getScheduleTimezone(
    task: ScheduledTask,
    schedulerOptions: { timezone?: string },
): string | undefined {
    const timezone = task.options.timezone?.trim() || schedulerOptions.timezone?.trim();
    return timezone || undefined;
}

/**
 * Asserts that the given string is a timezone identifier the runtime understands. croner
 * resolves timezones through `Intl`, so it accepts exactly what this check accepts. croner
 * rejects invalid values on its own, but its message cannot name the Vendure task that
 * carries the bad value, whereas this check can.
 */
export function assertValidTimezone(timezone: string, taskId: string): void {
    try {
        // Throws a RangeError for unknown timezone identifiers.
        Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
        throw new Error(
            `Invalid timezone "${timezone}" configured for scheduled task "${taskId}". ` +
                `The value must be an IANA timezone identifier, e.g. "Europe/Stockholm" or "UTC".`,
        );
    }
}
