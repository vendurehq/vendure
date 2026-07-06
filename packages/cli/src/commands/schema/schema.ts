import { cancel, intro, isCancel, log, outro, select, text } from '@clack/prompts';
import pc from 'picocolors';

import { abortIfNonInteractive, withInteractiveTimeout } from '../../utilities/utils';

const cancelledMessage = 'Schema generation cancelled.';
const schemaExamples = ['vendure schema --api admin', 'vendure schema --api shop --format json'];
const schemaInteractiveTimeoutOptions = {
    examples: schemaExamples,
    helpCommands: ['vendure schema --help'],
};

export interface SchemaOptions {
    api: 'admin' | 'shop';
    format?: 'sdl' | 'json';
    fileName?: string;
    outputDir?: string;
    /** Specify the path to a custom Vendure config file */
    config?: string;
}

/**
 * This command is used to generate a schema file for use with other GraphQL tools
 * such as IDE plugins.
 */
export async function schemaCommand(options?: SchemaOptions) {
    // Check if any non-interactive options are provided
    if (options?.api) {
        // Non-interactive mode
        await handleNonInteractiveMode(options);
        return;
    }

    // Interactive mode (original behavior)
    await handleInteractiveMode(options?.config);
}

async function handleNonInteractiveMode(options: SchemaOptions) {
    try {
        process.env.VENDURE_RUNNING_IN_CLI = 'true';
        const { generateSchema } = await import('./generate-schema/generate-schema');
        await generateSchema(options);
    } catch (e: unknown) {
        logError(e);
        process.exit(1);
    } finally {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    }
}

async function handleInteractiveMode(configFile?: string) {
    if (abortIfNonInteractive('vendure schema', schemaExamples)) {
        return;
    }

    // eslint-disable-next-line no-console
    console.log(`\n`);
    intro(pc.blue('🛠️️ Generate a schema file of your GraphQL API'));

    const apiType: 'admin' | 'shop' | symbol = await withInteractiveTimeout(async () => {
        return await select({
            message: 'Which API should we target?',
            options: [
                { value: 'admin', label: 'Admin API' },
                { value: 'shop', label: 'Shop API' },
            ],
        });
    }, schemaInteractiveTimeoutOptions);

    if (isCancel(apiType)) {
        cancel(cancelledMessage);
        process.exit(0);
    }

    const format: 'sdl' | 'json' | symbol = await withInteractiveTimeout(async () => {
        return await select({
            message: 'What format should we use for the schema?',
            options: [
                { value: 'sdl', label: 'SDL format (default)' },
                { value: 'json', label: 'JSON introspection query result' },
            ],
        });
    }, schemaInteractiveTimeoutOptions);

    if (isCancel(format)) {
        cancel(cancelledMessage);
        process.exit(0);
    }
    const outputDir = await withInteractiveTimeout(async () => {
        return await text({
            message: 'Output directory:',
            initialValue: process.cwd(),
        });
    }, schemaInteractiveTimeoutOptions);
    if (isCancel(outputDir)) {
        cancel(cancelledMessage);
        process.exit(0);
    }

    const fileName = await withInteractiveTimeout(async () => {
        const defaultBase = `schema${apiType === 'shop' ? '-shop' : ''}`;
        return await text({
            message: 'File name:',
            initialValue: format === 'sdl' ? `${defaultBase}.graphql` : `${defaultBase}.json`,
        });
    }, schemaInteractiveTimeoutOptions);

    if (isCancel(fileName)) {
        cancel(cancelledMessage);
        process.exit(0);
    }
    try {
        process.env.VENDURE_RUNNING_IN_CLI = 'true';
        const { generateSchema } = await import('./generate-schema/generate-schema');
        await generateSchema({
            api: apiType,
            format,
            fileName,
            outputDir,
            config: configFile,
        });
        outro('✅ Done!');
    } catch (e: unknown) {
        logError(e);
        process.exitCode = 1;
    } finally {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    }
}

function logError(error: unknown) {
    log.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
        log.error(error.stack);
    }
}
