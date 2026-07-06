import { cancel, intro, isCancel, log, outro, select } from '@clack/prompts';
import pc from 'picocolors';
import type { MigrationResult } from './migration-operations';

import { abortIfNonInteractive, withInteractiveTimeout } from '../../utilities/utils';

import {
    generateMigrationOperation,
    revertMigrationOperation,
    runMigrationsOperation,
} from './migration-operations';

const cancelledMessage = 'Migrate cancelled.';
const migrateExamples = ['vendure migrate -g my-migration', 'vendure migrate -r', 'vendure migrate --revert'];
const migrateInteractiveTimeoutOptions = {
    examples: migrateExamples,
    helpCommands: ['vendure migrate --help'],
};

export interface MigrateOptions {
    generate?: string;
    run?: boolean;
    revert?: boolean;
    outputDir?: string;
    /** Specify the path to a custom Vendure config file */
    config?: string;
}

type MigrateOperation = '--generate' | '--run' | '--revert';

/**
 * @description
 * Generate, run or revert a migration
 */
export async function migrateCommand(options?: MigrateOptions) {
    // Check if any non-interactive options are provided
    if (getRequestedOperations(options).length) {
        // Non-interactive mode
        await handleNonInteractiveMode(options ?? {});
        return;
    }

    // Interactive mode (original behavior)
    await handleInteractiveMode(options?.config);
}

async function handleNonInteractiveMode(options: MigrateOptions) {
    const requestedOperations = getRequestedOperations(options);
    if (requestedOperations.length > 1) {
        log.error(
            `The migrate command accepts only one operation at a time. Received: ${requestedOperations.join(', ')}.`,
        );
        log.info(
            'Run one of: vendure migrate --generate <name>, vendure migrate --run, or vendure migrate --revert.',
        );
        process.exit(1);
        return;
    }

    let result: MigrationResult | undefined;
    try {
        process.env.VENDURE_RUNNING_IN_CLI = 'true';

        if (options.generate) {
            result = await generateMigrationOperation({
                name: options.generate,
                outputDir: options.outputDir,
                config: options.config,
            });
        } else if (options.run) {
            result = await runMigrationsOperation(options.config);
        } else if (options.revert) {
            result = await revertMigrationOperation(options.config);
        }
    } catch (e: unknown) {
        logError(e);
        process.exit(1);
        return;
    } finally {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    }

    if (!result) {
        return;
    }
    if (result.success) {
        log.success(result.message);
    } else {
        log.error(result.message);
        process.exit(1);
    }
}

async function handleInteractiveMode(configFile?: string) {
    if (abortIfNonInteractive('vendure migrate', migrateExamples)) {
        return;
    }

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
    }, migrateInteractiveTimeoutOptions);

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
            await revertMigrationCommand.run({ configFile });
        }
        outro('✅ Done!');
    } catch (e: unknown) {
        logError(e);
        process.exitCode = 1;
    } finally {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    }
}

function getRequestedOperations(options?: MigrateOptions): MigrateOperation[] {
    return [
        options?.generate ? '--generate' : undefined,
        options?.run ? '--run' : undefined,
        options?.revert ? '--revert' : undefined,
    ].filter((operation): operation is MigrateOperation => operation != null);
}

function logError(error: unknown) {
    log.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
        log.error(error.stack);
    }
}
