import { cancel, intro, isCancel, log, outro, select } from '@clack/prompts';
import pc from 'picocolors';

import { withInteractiveTimeout } from '../../utilities/utils';

import {
    generateMigrationOperation,
    revertMigrationOperation,
    runMigrationsOperation,
} from './migration-operations';

const cancelledMessage = 'Migrate cancelled.';

export interface MigrateOptions {
    generate?: string;
    run?: boolean;
    revert?: boolean;
    outputDir?: string;
    /** Specify the path to a custom Vendure config file */
    config?: string;
}

/**
 * @description
 * Generate, run or revert a migration
 */
export async function migrateCommand(options?: MigrateOptions) {
    // Check if any non-interactive options are provided
    if (options?.generate || options?.run || options?.revert) {
        // Non-interactive mode
        await handleNonInteractiveMode(options);
        return;
    }

    // Interactive mode (original behavior)
    await handleInteractiveMode(options?.config);
}

async function handleNonInteractiveMode(options: MigrateOptions) {
    try {
        process.env.VENDURE_RUNNING_IN_CLI = 'true';

        if (options.generate) {
            const result = await generateMigrationOperation({
                name: options.generate,
                outputDir: options.outputDir,
                config: options.config,
            });

            if (result.success) {
                log.success(result.message);
            } else {
                log.error(result.message);
                process.exit(1);
            }
        } else if (options.run) {
            const result = await runMigrationsOperation(options.config);

            if (result.success) {
                log.success(result.message);
            } else {
                log.error(result.message);
                process.exit(1);
            }
        } else if (options.revert) {
            const result = await revertMigrationOperation(options.config);

            if (result.success) {
                log.success(result.message);
            } else {
                log.error(result.message);
                process.exit(1);
            }
        }

        process.env.VENDURE_RUNNING_IN_CLI = undefined;
    } catch (e: any) {
        log.error(e.message as string);
        if (e.stack) {
            log.error(e.stack);
        }
        process.exit(1);
    }
}

async function handleInteractiveMode(configFile?: string) {
    // eslint-disable-next-line no-console
    console.log(`\n`);
    intro(pc.blue('🛠️️ Vendure migrations'));

    const action = await withInteractiveTimeout(async () => {
        return await select({
            message: 'What would you like to do?',
            options: [
                { value: 'generate', label: 'Generate a new migration' },
                { value: 'run', label: 'Run pending migrations' },
                { value: 'revert', label: 'Revert the last migration' },
            ],
        });
    });

    if (isCancel(action)) {
        cancel(cancelledMessage);
        process.exit(0);
    }
    try {
        process.env.VENDURE_RUNNING_IN_CLI = 'true';
        if (action === 'generate') {
            const { generateMigrationCommand } = await import('./generate-migration/generate-migration');
            await generateMigrationCommand.run({ configFile });
        }
        if (action === 'run') {
            const { runMigrationCommand } = await import('./run-migration/run-migration');
            await runMigrationCommand.run({ configFile });
        }
        if (action === 'revert') {
            const { revertMigrationCommand } = await import('./revert-migration/revert-migration');
            await revertMigrationCommand.run();
        }
        outro('✅ Done!');
        process.env.VENDURE_RUNNING_IN_CLI = undefined;
    } catch (e: any) {
        log.error(e.message as string);
        if (e.stack) {
            log.error(e.stack);
        }
    }
}
