import { PluginCommonModule } from '../../plugin/plugin-common.module';
import { VendurePlugin } from '../../plugin/vendure-plugin';

import {
    DEFAULT_MANUAL_TRIGGER_CHECK_INTERVAL,
    DEFAULT_SCHEDULER_PLUGIN_OPTIONS,
    DEFAULT_TIMEOUT,
} from './constants';
import { DefaultSchedulerStrategy } from './default-scheduler-strategy';
import { ScheduledTaskRecord } from './scheduled-task-record.entity';
import { StaleTaskService } from './stale-task.service';
import { DefaultSchedulerPluginOptions } from './types';

/**
 * @description
 * This plugin configures a default scheduling strategy that executes scheduled
 * tasks using the database to ensure that each task is executed exactly once
 * at the scheduled time, even if there are multiple instances of the worker
 * running.
 *
 * @example
 * ```ts
 * import { DefaultSchedulerPlugin, VendureConfig } from '@vendure/core';
 *
 * export const config: VendureConfig = {
 *   plugins: [
 *     DefaultSchedulerPlugin.init({
 *       // The default is 60s, but you can override it here
 *       defaultTimeout: '10s',
 *     }),
 *   ],
 * };
 * ```
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 * @docsPage DefaultSchedulerPlugin
 * @docsWeight 0
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ScheduledTaskRecord],
    configuration: config => {
        config.schedulerOptions.schedulerStrategy = new DefaultSchedulerStrategy();
        return config;
    },
    providers: [
        {
            provide: DEFAULT_SCHEDULER_PLUGIN_OPTIONS,
            useFactory: () => DefaultSchedulerPlugin.options,
        },
        StaleTaskService,
    ],
    compatibility: '>0.0.0',
})
export class DefaultSchedulerPlugin {
    static options: DefaultSchedulerPluginOptions = {
        defaultTimeout: DEFAULT_TIMEOUT,
        manualTriggerCheckInterval: DEFAULT_MANUAL_TRIGGER_CHECK_INTERVAL,
    };

    static init(config?: DefaultSchedulerPluginOptions) {
        this.options = { ...this.options, ...(config || {}) };
        return this;
    }
}
