import { spinner } from '@clack/prompts';
import path from 'node:path';
import { Project } from 'ts-morph';

import { getTsMorphProject, selectTsConfigFile } from '../utilities/ast-utils.js';
import { pauseForPromptDisplay } from '../utilities/utils.js';

import { VendurePluginRef } from './vendure-plugin-ref.js';

export async function analyzeProject(options: {
    providedVendurePlugin?: VendurePluginRef;
    cancelledMessage?: string;
    config?: string;
}) {
    const providedVendurePlugin = options.providedVendurePlugin;
    let project = providedVendurePlugin?.classDeclaration.getProject();
    let tsConfigPath: string | undefined;
    let vendureTsConfig: string | undefined;
    let rootTsConfig: string | undefined;
    let isMonorepo: boolean | undefined;

    if (!providedVendurePlugin) {
        const projectSpinner = spinner();
        const tsConfigFile = selectTsConfigFile();
        projectSpinner.start('Analyzing project...');
        await pauseForPromptDisplay();
        const result = await getTsMorphProject(
            {
                compilerOptions: {
                    // When running via the CLI, we want to find all source files,
                    // not just the compiled .js files.
                    rootDir: path.resolve('./src'),
                },
            },
            tsConfigFile,
        );
        project = result.project;
        tsConfigPath = result.tsConfigPath;
        vendureTsConfig = result.vendureTsConfig;
        rootTsConfig = result.rootTsConfig;
        isMonorepo = result.isMonorepo;
        projectSpinner.stop('Project analyzed');
    }
    return {
        project: project as Project,
        tsConfigPath,
        vendureTsConfig,
        rootTsConfig,
        isMonorepo,
        config: options.config,
    };
}
