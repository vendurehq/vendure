import type { ScheduledTask } from './scheduled-task';

/**
 * Resolves the timezone in which a task's cron schedule is evaluated. A task-level
 * `timezone` takes precedence over the global `schedulerOptions.timezone`, and blank
 * values are treated as unset. Returning `undefined` makes croner evaluate the
 * schedule in the timezone of the Node.js process.
 */
export function getScheduleTimezone(
    task: ScheduledTask,
    schedulerOptions: { timezone?: string },
): string | undefined {
    const timezone = task.options.timezone?.trim() || schedulerOptions.timezone?.trim();
    return timezone || undefined;
}

/**
 * Asserts that `Intl` accepts every configured timezone identifier, naming the option or
 * task that carries a bad one. croner also rejects invalid values, but its error cannot
 * say where the value came from.
 */
export function assertValidTimezones(schedulerOptions: { timezone?: string; tasks?: ScheduledTask[] }): void {
    assertValidTimezone(schedulerOptions.timezone, 'the `schedulerOptions.timezone` option');
    for (const task of schedulerOptions.tasks ?? []) {
        assertValidTimezone(task.options.timezone, `the scheduled task "${task.id}"`);
    }
}

function assertValidTimezone(timezone: string | undefined, source: string): void {
    const trimmed = timezone?.trim();
    if (!trimmed) {
        return;
    }
    try {
        // The formatter is discarded: the call is here for the RangeError that `Intl`
        // throws on an unknown identifier. croner resolves timezones through `Intl` too,
        // so it accepts exactly what this accepts.
        Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    } catch {
        throw new Error(
            `Invalid timezone "${trimmed}" configured for ${source}. ` +
                `The value must be an IANA timezone identifier, e.g. "Europe/Stockholm" or "UTC".`,
        );
    }
}
