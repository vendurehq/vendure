import { CommandContext, fail } from '@vendure/common/lib/command';
import path from 'node:path';
import { StructureKind } from 'ts-morph';

import { openProject } from '../../../shared/open-project.js';
import { PackageJson } from '../../../shared/package-json-ref.js';
import { getPluginClasses, getRelativeImportPath } from '../../../utilities/ast-utils.js';

import { packageJsonNotFound, pluginNotFound } from './add-codegen.errors.js';
import { CodegenConfigRef } from './codegen-config-ref.js';

const CODEGEN_PACKAGES = [
    { pkg: '@graphql-codegen/cli', isDevDependency: true },
    { pkg: '@graphql-codegen/typescript', isDevDependency: true },
];

/**
 * Sets up GraphQL code generation for one plugin: installs the codegen packages, adds the plugin
 * to `codegen.ts` and adds a `codegen` script.
 */
export async function run(input: { plugin: string }, ctx: CommandContext) {
    const { project } = await openProject();
    const pluginClass = getPluginClasses(project).find(c => c.getName() === input.plugin);
    if (!pluginClass) {
        const available = getPluginClasses(project)
            .map(c => c.getName())
            .filter((name): name is string => !!name);
        return fail(pluginNotFound, { plugin: input.plugin, available });
    }

    const packageJson = new PackageJson(project);
    if (!packageJson.locatePackageJsonWithVendureDependency()) {
        return fail(packageJsonNotFound, {});
    }

    const installed: string[] = [];
    const commands = packageJson.getInstallCommands(CODEGEN_PACKAGES);
    for (const [index, { command, args }] of commands.entries()) {
        const line = `${command} ${args.join(' ')}`;
        ctx.progress(`Installing dependencies: ${line}`, index, commands.length);
        const result = await ctx.spawn(command, args, { cwd: packageJson.getPackageRootDir().getPath() });
        if (result.exitCode === 0) {
            installed.push(line);
        } else {
            ctx.notice('warning', `Failed to install dependencies with "${line}". Install them yourself.`);
        }
    }

    ctx.progress('Configuring codegen file');
    const codegenFile = new CodegenConfigRef(project, packageJson.getPackageRootDir());
    const rootDir = project.getDirectory('.');
    if (!rootDir) {
        throw new Error('Could not find the root directory of the project');
    }
    const relativePluginPath = getRelativeImportPath({ from: rootDir, to: pluginClass.getSourceFile() });
    codegenFile.addEntryToGeneratesObject({
        name: `'${path.dirname(relativePluginPath)}/gql/generated.ts'`,
        kind: StructureKind.PropertyAssignment,
        initializer: `{ plugins: ['typescript'] }`,
    });
    packageJson.addScriptToRootPackageJson('codegen', 'graphql-codegen --config codegen.ts');
    await project.save();

    return {
        plugin: input.plugin,
        installed,
        modifiedFiles: [codegenFile.sourceFile.getFilePath()],
        nextSteps: ['Run "npx vendure schema" to generate a schema file', 'Run "npm run codegen"'],
    };
}
