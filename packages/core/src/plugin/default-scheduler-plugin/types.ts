/**
 * @description
 * The options for the {@link DefaultSchedulerPlugin}.
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 * @docsPage DefaultSchedulerPlugin
 */
export interface DefaultSchedulerPluginOptions {
    /**
     * @description
     * The default timeout for scheduled tasks.
     *
     * @default 60_000ms
     */
    defaultTimeout?: string | number;
    /**
     * @description
     * The interval at which the plugin will check for manually triggered tasks.
     *
     * @default 10_000ms
     */
    manualTriggerCheckInterval?: string | number;
}
