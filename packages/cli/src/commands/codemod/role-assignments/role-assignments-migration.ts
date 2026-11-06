import { log, spinner } from '@clack/prompts';
import fs from 'fs-extra';
import path from 'node:path';
import { Project, SourceFile } from 'ts-morph';

import { defaultManipulationSettings } from '../../../constants';
import { findTsConfig } from '../shared/find-ts-config';

import { FlagCollector } from './flags';
import { transformFindOptions } from './transforms/find-options';
import { transformGraphqlFile, transformGraphqlTemplates } from './transforms/graphql-documents';
import { flagRemovedUsages } from './transforms/removed-usages';

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git']);

/**
 * Updates a project for the v4 role assignment model, where `User.roles` and `Role.channels`
 * are replaced by `RoleAssignment` rows of (user, role, channel).
 *
 * Mechanical edits are applied:
 * - GraphQL documents (`.graphql` files, `gql` / `graphql` templates): `channels` is removed from
 *   Role selections and `channelIds` from inline `createRole` / `updateRole` inputs.
 * - TypeORM and Vendure `relations` options: `User.roles` and `Role.channels` paths are removed.
 *
 * Code whose replacement depends on intent, such as reading `user.roles`, is marked with a
 * `// TODO(vendure-v4):` comment naming the replacement. Running the codemod twice adds nothing.
 *
 * @param targetPath — Optional absolute path to the project directory.
 *                     If omitted, uses the current working directory.
 */
export async function roleAssignmentsMigration(targetPath?: string) {
    const s = spinner();
    s.start('Analyzing project...');

    const projectDir = path.resolve(targetPath ?? process.cwd());
    const tsConfigPath = findTsConfig(projectDir);

    let project: Project;
    try {
        project = new Project({
            tsConfigFilePath: tsConfigPath,
            manipulationSettings: defaultManipulationSettings,
            compilerOptions: {
                skipLibCheck: true,
            },
        });
        project.enableLogging(false);
    } catch (e: unknown) {
        s.stop('Failed to initialize project');
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(
            `Could not load TypeScript project: ${message}\n` +
                `Searched in: ${projectDir}\n` +
                `Make sure the tsconfig.json at ${tsConfigPath} is valid.`,
        );
    }

    const sourceFiles = project.getSourceFiles().filter(sf => isProjectFile(sf.getFilePath(), projectDir));
    const graphqlFiles = await findGraphqlFiles(projectDir);
    s.stop(
        `Found ${sourceFiles.length} TypeScript and ${graphqlFiles.length} GraphQL files (using ${tsConfigPath})`,
    );

    let totalChanges = 0;
    let totalFlags = 0;
    let filesChanged = 0;

    for (const filePath of graphqlFiles) {
        try {
            const changes = await transformGraphqlFile(filePath);
            if (changes > 0) {
                totalChanges += changes;
                filesChanged++;
                log.info(`Updated: ${filePath} (${changes} changes)`);
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            log.warn(`Error processing ${filePath}: ${message}`);
        }
    }

    for (const sourceFile of sourceFiles) {
        const filePath = sourceFile.getFilePath();
        try {
            const { changes, flagged } = transformSourceFile(sourceFile);
            if (changes + flagged > 0) {
                totalChanges += changes;
                totalFlags += flagged;
                filesChanged++;
                log.info(`Updated: ${filePath} (${changes} changes, ${flagged} flagged)`);
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            log.warn(`Error processing ${filePath}: ${message}`);
        }
    }

    if (totalChanges + totalFlags === 0) {
        log.info(
            'Nothing to change. Places flagged on an earlier run are marked "TODO(vendure-v4)" until updated by hand.',
        );
        return;
    }
    const saveSpinner = spinner();
    saveSpinner.start('Saving changes...');
    await project.save();
    saveSpinner.stop(`Done! ${totalChanges} changes across ${filesChanged} files`);
    if (totalFlags > 0) {
        log.warn(`${totalFlags} places need a manual update. Search for "TODO(vendure-v4)" to find them.`);
    }
}

/**
 * Runs the transforms on one file: edits first, then flags, so the flagged positions are final.
 */
export function transformSourceFile(sourceFile: SourceFile): { changes: number; flagged: number } {
    const flags = new FlagCollector(sourceFile);
    let changes = transformGraphqlTemplates(sourceFile);
    changes += transformFindOptions(sourceFile, flags);
    flagRemovedUsages(sourceFile, flags);
    return { changes, flagged: flags.apply() };
}

function isProjectFile(filePath: string, projectDir: string): boolean {
    if (!filePath.startsWith(projectDir + path.sep) || filePath.endsWith('.d.ts')) {
        return false;
    }
    return !path
        .relative(projectDir, filePath)
        .split(path.sep)
        .some(segment => SKIPPED_DIRECTORIES.has(segment));
}

async function findGraphqlFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) {
            continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await findGraphqlFiles(fullPath)));
        } else if (/\.(graphql|gql)$/.test(entry.name)) {
            files.push(fullPath);
        }
    }
    return files;
}
