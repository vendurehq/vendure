import { ScheduledTask } from '../../scheduler/scheduled-task';
import { SettingsStoreService } from '../../service/helpers/settings-store/settings-store.service';
import { Logger } from '../logger/vendure-logger';

import { CleanupOrphanedSettingsStoreEntriesOptions } from './settings-store-types';

/**
 * @description
 * A {@link ScheduledTask} that cleans up orphaned settings store entries from the database.
 * Orphaned entries are entries that no longer have corresponding field definitions
 * in the settings store configuration.
 *
 * This task can be configured with options for dry-run mode, age thresholds,
 * and batch processing settings. Users can override or disable this task entirely
 * using the existing ScheduledTask APIs.
 *
 * @example
 * ```ts
 * // Override the default task with custom options
 * const customCleanupTask = new ScheduledTask({
 *   id: 'clean-orphaned-settings-store',
 *   description: 'Custom orphaned settings store cleanup',
 *   schedule: cron => cron.every(7).days(),
 *   async execute({ injector }) {
 *     const settingsStoreService = injector.get(SettingsStoreService);
 *     return settingsStoreService.cleanupOrphanedEntries({
 *       olderThan: '30d',
 *       maxDeleteCount: 500,
 *       batchSize: 50,
 *     });
 *   },
 * });
 * ```
 *
 * @since 3.4.0
 * @docsCategory SettingsStore
 * @docsPage SettingsStore
 */
export const cleanOrphanedSettingsStoreTask = new ScheduledTask({
    id: 'clean-orphaned-settings-store',
    description: 'Clean orphaned settings store entries that no longer have field definitions',
    schedule: cron => cron.every(7).days(),
    params: {
        olderThan: '7d',
    },
    async execute({ injector, params }) {
        const options: CleanupOrphanedSettingsStoreEntriesOptions = {
            olderThan: params.olderThan,
            maxDeleteCount: 1000,
            batchSize: 100,
            dryRun: false,
        };

        const settingsStoreService = injector.get(SettingsStoreService);
        const result = await settingsStoreService.cleanupOrphanedEntries(options);

        if (result.dryRun) {
            Logger.info(`Dry run: would delete ${result.deletedCount} orphaned settings store entries`);
            if (result.deletedEntries.length > 0) {
                Logger.verbose(
                    `Sample entries that would be deleted: ${result.deletedEntries
                        .map(entry => `${entry.key} (scope: ${entry.scope})`)
                        .join(', ')}`,
                );
            }
        } else {
            Logger.info(`Deleted ${result.deletedCount} orphaned settings store entries`);
        }

        return {
            orphanedEntriesDeleted: result.deletedCount,
            dryRun: result.dryRun,
            sampleDeleted: result.deletedEntries.length,
        };
    },
});
