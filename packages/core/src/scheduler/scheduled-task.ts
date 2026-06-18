import CronTime from 'cron-time-generator';

import { RequestContext } from '../api';
import { Injector } from '../common/index';
import { RequestContextService } from '../service/helpers/request-context/request-context.service';
import { ChannelService } from '../service/services/channel.service';

/**
 * @description
 * The arguments passed to the execute method of a scheduled task.
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 * @docsPage ScheduledTask
 */
export interface ScheduledTaskExecutionArgs<C extends Record<string, any> = Record<string, any>> {
    /**
     * @description
     * The injector instance.
     */
    injector: Injector;
    /**
     * @description
     * A RequestContext instance that is configured for the scheduled task.
     */
    scheduledContext: RequestContext;
    /**
     * @description
     * The parameters for the scheduled task.
     */
    params: C;
}

/**
 * @description
 * The configuration for a scheduled task.
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 * @docsPage ScheduledTask
 */
export interface ScheduledTaskConfig<C extends Record<string, any> = Record<string, any>> {
    /**
     * @description
     * The unique identifier for the scheduled task.
     */
    id: string;
    /**
     * @description
     * The description for the scheduled task.
     */
    description?: string;
    /**
     * @description
     * Optional parameters that will be passed to the `execute` function.
     */
    params?: C;
    /**
     * @description
     * The cron schedule for the scheduled task. This can be a standard cron expression or
     * a function that returns a [cron-time-generator](https://www.npmjs.com/package/cron-time-generator)
     * expression.
     *
     * @example
     * ```ts
     * // Standard cron expression
     * { schedule: '0 0-23/5 * * *', } // every 5 hours
     * { schedule: '0 22 * * *', } // every day at 10:00 PM
     *
     * // Cron-time-generator expression
     * { schedule: cronTime => cronTime.every(2).minutes(), }
     * { schedule: cronTime => cronTime.every(5).hours(), }
     * ```
     */
    schedule: string | ((cronTime: typeof CronTime) => string);
    /**
     * @description
     * The timeout for the scheduled task. If the task takes longer than the timeout, the task
     * will be considered to have failed with a timeout error.
     *
     * @default 60_000ms
     */
    timeout?: number | string;
    /**
     * @description
     * Whether the scheduled task should be prevented from running if it is already running.
     *
     * @default true
     */
    preventOverlap?: boolean;
    /**
     * @description
     * The function that will be executed when the scheduled task is run.
     */
    execute(args: ScheduledTaskExecutionArgs<C>): Promise<any>;
}

/**
 * @description
 * Use this class to define a scheduled task that will be executed at a given cron schedule.
 *
 * @example
 * ```ts
 * import { ScheduledTask } from '\@vendure/core';
 *
 * const task = new ScheduledTask({
 *     id: 'test-job',
 *     schedule: cron => cron.every(2).minutes(),
 *     execute: async ({ injector, scheduledContext, params }) => {
 *         // some logic here
 *     },
 * });
 * ```
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 * @docsPage ScheduledTask
 * @docsWeight 0
 */
export class ScheduledTask<C extends Record<string, any> = Record<string, any>> {
    constructor(private readonly config: ScheduledTaskConfig<C>) {}

    get id() {
        return this.config.id;
    }

    get options() {
        return this.config;
    }

    async execute(injector: Injector) {
        const requestContextService = injector.get(RequestContextService);
        const channelService = injector.get(ChannelService);
        const defaultChannel = await channelService.getDefaultChannel();

        const scheduledContext = await requestContextService.create({
            apiType: 'admin',
            channelOrToken: defaultChannel,
        });

        return this.config.execute({
            injector,
            scheduledContext,
            params: this.config.params ?? ({} as any),
        });
    }

    /**
     * @description
     * This method allows you to further configure existing scheduled tasks. For example, you may
     * wish to change the schedule or timeout of a task, without having to define a new task.
     *
     * @example
     * ```ts
     * import { ScheduledTask } from '\@vendure/core';
     *
     * const task = new ScheduledTask({
     *     id: 'test-job',
     *     schedule: cron => cron.every(2).minutes(),
     *     execute: async ({ injector, scheduledContext, params }) => {
     *         // some logic here
     *     },
     * });
     *
     * // later, you can configure the task
     * task.configure({ schedule: cron => cron.every(5).minutes() });
     * ```
     */
    configure(additionalConfig: Partial<Pick<ScheduledTaskConfig<C>, 'schedule' | 'timeout' | 'params'>>) {
        if (additionalConfig.schedule) {
            this.config.schedule = additionalConfig.schedule;
        }
        if (additionalConfig.timeout) {
            this.config.timeout = additionalConfig.timeout;
        }
        if (additionalConfig.params) {
            this.config.params = additionalConfig.params;
        }
        return this;
    }
}
