import { cancel, intro, isCancel, log, outro, select } from '@clack/prompts';
import fs from 'fs-extra';
import path from 'node:path';
import pc from 'picocolors';

import { withInteractiveTimeout } from '../../utilities/utils';

/**
 * Registry of available codemods. To add a new codemod, just add an entry here.
 * Each codemod receives an optional resolved target path. If no path is provided,
 * the codemod should operate on the current working directory.
 */
const CODEMODS: Record<string, { description: string; run: (targetPath?: string) => Promise<void> }> = {
    'dashboard-base-ui': {
        description: 'Migrate dashboard extensions from Radix UI to Base UI patterns',
        run: async (targetPath?: string) => {
            const { dashboardUiMigration } = await import('./dashboard-ui/dashboard-ui-migration');
            await dashboardUiMigration(targetPath);
        },
    },
};

export async function codemodCommand(transform?: string, targetPath?: string) {
    // Resolve and validate the target path if provided
    const resolvedPath = targetPath ? resolveAndValidatePath(targetPath) : undefined;

    if (transform && transform.trim().length > 0) {
        // Non-interactive: run the specified codemod
        const codemod = CODEMODS[transform];
        if (!codemod) {
            log.error(`Unknown codemod: "${transform}"`);
            log.info(`Available codemods:\n${formatCodemodList()}`);
            process.exit(1);
        }
        try {
            await codemod.run(resolvedPath);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            log.error(`Codemod "${transform}" failed: ${message}`);
            if (e instanceof Error && e.stack) {
                log.error(e.stack);
            }
            process.exit(1);
        }
        return;
    }

    // Interactive mode: let the user pick a codemod.
    // Path is not supported in interactive mode — run from the project directory.
    // eslint-disable-next-line no-console
    console.log(`\n`);
    intro(pc.blue('🔧 Vendure Codemods'));

    const selected = await withInteractiveTimeout(async () => {
        return await select({
            message: 'Which codemod would you like to run?',
            options: Object.entries(CODEMODS).map(([name, { description }]) => ({
                value: name,
                label: `${pc.blue(name)} — ${description}`,
            })),
        });
    });

    if (isCancel(selected)) {
        cancel('Codemod cancelled.');
        process.exit(0);
    }

    const selectedCodemod = CODEMODS[selected as string];
    if (!selectedCodemod) {
        log.error('Selected codemod not found.');
        process.exit(1);
    }

    try {
        await selectedCodemod.run(resolvedPath);
        outro('✅ Done!');
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        log.error(`Codemod failed: ${message}`);
        if (e instanceof Error && e.stack) {
            log.error(e.stack);
        }
        process.exit(1);
    }
}

/**
 * Resolves a path argument to an absolute path and validates it exists
 * and is a directory. Exits with an error if validation fails.
 */
function resolveAndValidatePath(targetPath: string): string {
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) {
        log.error(`Path does not exist: ${resolved}`);
        process.exit(1);
    }
    if (!fs.statSync(resolved).isDirectory()) {
        log.error(`Path is not a directory: ${resolved}`);
        process.exit(1);
    }
    return resolved;
}

function formatCodemodList(): string {
    return Object.entries(CODEMODS)
        .map(([name, { description }]) => `  ${name} — ${description}`)
        .join('\n');
}
