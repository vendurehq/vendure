import { cancel, intro, isCancel, log, outro, select, text } from '@clack/prompts';
import pc from 'picocolors';

import { withInteractiveTimeout } from '../../utilities/utils';

const cancelledMessage = 'Schema generation cancelled.';

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
    intro(pc.blue('🛠️️ Generate a schema file of your GraphQL API'));

    const apiType: 'admin' | 'shop' | symbol = await withInteractiveTimeout(async () => {
        return await select({
            message: 'Which API should we target?',
            options: [
                { value: 'admin', label: 'Admin API' },
                { value: 'shop', label: 'Shop API' },
            ],
        });
    });

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
    });

    if (isCancel(format)) {
        cancel(cancelledMessage);
        process.exit(0);
    }
    const outputDir = await withInteractiveTimeout(async () => {
        return await text({
            message: 'Output directory:',
            initialValue: process.cwd(),
        });
    });
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
    });

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
        process.env.VENDURE_RUNNING_IN_CLI = undefined;
    } catch (e: any) {
        log.error(e.message as string);
        if (e.stack) {
            log.error(e.stack);
        }
    }
}
