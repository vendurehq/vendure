import path from 'node:path';
import { Project, SourceFile, StructureKind } from 'ts-morph';

import { PackageJson } from '../../../shared/package-json-ref.js';
import { getRelativeImportPath } from '../../../utilities/ast-utils.js';

import { CodegenConfigRef } from './codegen-config-ref.js';

/** What `add codegen` installs. Both the command and the interactive `add` flow use it. */
export const CODEGEN_PACKAGES = [
    { pkg: '@graphql-codegen/cli', isDevDependency: true },
    { pkg: '@graphql-codegen/typescript', isDevDependency: true },
];

/**
 * Adds a `generates` entry for each plugin to `codegen.ts`, creating the file when it does not
 * exist, and adds the `codegen` script to the root `package.json`. It does not save the project.
 */
export function configureCodegen(
    project: Project,
    packageJson: PackageJson,
    pluginSourceFiles: SourceFile[],
): CodegenConfigRef {
    const codegenFile = new CodegenConfigRef(project, packageJson.getPackageRootDir());
    const rootDir = project.getDirectory('.');
    if (!rootDir) {
        throw new Error('Could not find the root directory of the project');
    }
    for (const sourceFile of pluginSourceFiles) {
        const relativePluginPath = getRelativeImportPath({ from: rootDir, to: sourceFile });
        codegenFile.addEntryToGeneratesObject({
            name: `'${path.dirname(relativePluginPath)}/gql/generated.ts'`,
            kind: StructureKind.PropertyAssignment,
            initializer: `{ plugins: ['typescript'] }`,
        });
    }
    packageJson.addScriptToRootPackageJson('codegen', 'graphql-codegen --config codegen.ts');
    return codegenFile;
}
