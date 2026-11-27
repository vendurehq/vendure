import { CommandContext, fail, isErrorResult } from '@vendure/common/lib/command';

import { openProject } from '../../../shared/open-project.js';
import { PackageJson } from '../../../shared/package-json-ref.js';
import { packageJsonNotFound } from '../add.errors.js';
import { findPlugin } from '../add.project.js';

import { CODEGEN_PACKAGES, configureCodegen } from './add-codegen.shared.js';

/**
 * Sets up GraphQL code generation for one plugin: installs the codegen packages, adds the plugin
 * to `codegen.ts` and adds a `codegen` script.
 */
export async function run(input: { plugin: string }, ctx: CommandContext) {
    const { project } = await openProject();
    const plugin = findPlugin(project, input.plugin);
    if (isErrorResult(plugin)) {
        return plugin;
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
    const codegenFile = configureCodegen(project, packageJson, [plugin.classDeclaration.getSourceFile()]);
    await project.save();

    return {
        plugin: input.plugin,
        installed,
        modifiedFiles: [codegenFile.sourceFile.getFilePath()],
        nextSteps: ['Run "npx vendure schema" to generate a schema file', 'Run "npm run codegen"'],
    };
}
