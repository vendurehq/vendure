import { log, spinner } from '@clack/prompts';
import path from 'node:path';
import { Project } from 'ts-morph';

import { defaultManipulationSettings } from '../../../constants';
import { findTsConfig } from '../shared/find-ts-config';

import { transformAccordionProps } from './transforms/accordion-props';
import { transformAsChildToRender } from './transforms/as-child-to-render';
import { transformFormComponents } from './transforms/form-components';
import { transformImportConsolidation } from './transforms/import-consolidation';
import { transformSelectItemsProp } from './transforms/select-items-prop';

/**
 * Runs all dashboard UI migration transforms on every .tsx file in the project.
 *
 * @param targetPath — Optional absolute path to the project directory.
 *                     If omitted, uses the current working directory.
 *
 * Creates its own ts-morph Project directly instead of using getTsMorphProject(),
 * because that function does vendure-specific monorepo/package.json detection
 * which fails in external projects. The codemod just needs to load TSX files.
 *
 * Transform order matters:
 * 1. asChild → render prop — must run before import consolidation so the
 *    `asChild` attribute is gone before imports are rewritten.
 * 2. FormField → FormFieldWrapper — removes old form imports and adds
 *    FormFieldWrapper. Must run before import consolidation so that any
 *    remaining form imports from third-party sources get caught.
 * 3. Import consolidation — rewrites @radix-ui/*, @vendure-io/ui, @base-ui
 *    imports to @vendure/dashboard. Runs after JSX transforms so it sees the
 *    final set of needed imports. Also rewrites namespace member access sites.
 * 4. Accordion prop removal — independent, order doesn't matter.
 * 5. Select items warning — read-only, no mutations.
 */
export async function dashboardUiMigration(targetPath?: string) {
    const s = spinner();
    s.start('Analyzing project...');

    const projectDir = targetPath ?? process.cwd();
    const tsConfigPath = findTsConfig(projectDir, ['tsconfig.dashboard.json', 'tsconfig.json']);

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

    const resolvedProjectDir = path.resolve(projectDir) + path.sep;
    let sourceFiles = project
        .getSourceFiles()
        .filter(sf => sf.getFilePath().endsWith('.tsx') && sf.getFilePath().startsWith(resolvedProjectDir));

    // If no TSX files were picked up by the tsconfig, scan the directory
    // tree manually and add them. This handles cases where the tsconfig
    // include patterns don't cover dashboard extension files.
    if (sourceFiles.length === 0) {
        const glob = path.join(projectDir, '**/*.tsx');
        project.addSourceFilesAtPaths(glob);
        sourceFiles = project
            .getSourceFiles()
            .filter(
                sf => sf.getFilePath().endsWith('.tsx') && sf.getFilePath().startsWith(resolvedProjectDir),
            );
    }

    s.stop(`Found ${sourceFiles.length} TSX files (using ${tsConfigPath})`);

    if (sourceFiles.length === 0) {
        log.info(`No .tsx files found in ${projectDir}`);
        return;
    }

    let totalChanges = 0;
    let filesChanged = 0;

    for (const sourceFile of sourceFiles) {
        const filePath = sourceFile.getFilePath();
        let fileChanges = 0;

        try {
            fileChanges += transformAsChildToRender(sourceFile);
            fileChanges += transformFormComponents(sourceFile);
            fileChanges += transformImportConsolidation(sourceFile);
            fileChanges += transformAccordionProps(sourceFile);
            fileChanges += transformSelectItemsProp(sourceFile);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            log.warn(`Error processing ${filePath}: ${message}`);
            continue;
        }

        if (fileChanges > 0) {
            totalChanges += fileChanges;
            filesChanged++;
            log.info(`Updated: ${filePath} (${fileChanges} changes)`);
        }
    }

    if (totalChanges > 0) {
        const saveSpinner = spinner();
        saveSpinner.start('Saving changes...');
        await project.save();
        saveSpinner.stop(`Done! ${totalChanges} changes across ${filesChanged} files`);
    } else {
        log.info('No Radix UI patterns found. Your code is already up to date!');
    }
}
