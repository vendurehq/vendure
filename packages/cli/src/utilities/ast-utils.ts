import { log } from '@clack/prompts';
import fs from 'fs-extra';
import path from 'node:path';
import { Directory, Node, Project, ProjectOptions, ScriptKind, SourceFile } from 'ts-morph';

import { defaultManipulationSettings } from '../constants';
import { EntityRef } from '../shared/entity-ref';
import { PackageJson } from '../shared/package-json-ref';

import { detectMonorepoStructure, findTsConfigInDir } from './monorepo-utils';

export function selectTsConfigFile() {
    const tsConfigFiles = fs.readdirSync(process.cwd()).filter(f => /^tsconfig.*\.json$/.test(f));
    if (tsConfigFiles.length === 0) {
        throw new Error('No tsconfig files found in current directory');
    }

    // Prefer the canonical "tsconfig.json" when multiple configs are present.
    const defaultConfig = 'tsconfig.json';
    if (tsConfigFiles.includes(defaultConfig)) {
        return defaultConfig;
    }

    // Fallback: return the first match (stable order from fs.readdirSync).
    return tsConfigFiles[0];
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function getTsMorphProject(options: ProjectOptions = {}, providedTsConfigPath?: string) {
    const tsConfigFile = providedTsConfigPath ?? selectTsConfigFile();
    const tsConfigPath = path.isAbsolute(tsConfigFile)
        ? tsConfigFile
        : path.join(process.cwd(), tsConfigFile);
    if (!fs.existsSync(tsConfigPath)) {
        throw new Error(`No tsconfig.json found in current directory (looked for ${tsConfigPath})`);
    }
    const project = new Project({
        tsConfigFilePath: tsConfigPath,
        manipulationSettings: defaultManipulationSettings,
        compilerOptions: {
            skipLibCheck: true,
        },
        ...options,
    });
    project.enableLogging(false);

    const { vendureTsConfig, rootTsConfig, isMonorepo } = detectTsConfigPaths(tsConfigPath, project);

    return { project, tsConfigPath, vendureTsConfig, rootTsConfig, isMonorepo };
}

/**
 * Detects whether we're in a monorepo setup and returns the appropriate tsconfig paths.
 * In a regular repo, vendureTsConfig and rootTsConfig will be the same.
 * In a monorepo, vendureTsConfig points to the package-level config (e.g., packages/backend/tsconfig.json)
 * and rootTsConfig points to the root-level config.
 */
function detectTsConfigPaths(
    currentTsConfigPath: string,
    project: Project,
): {
    vendureTsConfig: string;
    rootTsConfig: string;
    isMonorepo: boolean;
} {
    const packageJson = new PackageJson(project);

    // Find vendure package.json (this handles monorepo search automatically)
    const vendurePackageJsonPath = packageJson.locatePackageJsonWithVendureDependency();

    if (!vendurePackageJsonPath) {
        // Couldn't find vendure package, use current tsconfig
        return {
            vendureTsConfig: currentTsConfigPath,
            rootTsConfig: currentTsConfigPath,
            isMonorepo: false,
        };
    }

    const vendureDir = path.dirname(vendurePackageJsonPath);

    // Find vendure tsconfig (in the same dir as vendure package.json)
    const vendureTsConfig = findTsConfigInDir(vendureDir) || currentTsConfigPath;

    // Detect if we're in a monorepo by checking if vendureDir is nested under a packages/apps/libs structure
    const monorepoInfo = detectMonorepoStructure(vendureDir);

    if (!monorepoInfo.isMonorepo || !monorepoInfo.root) {
        // Not in a monorepo structure, regular mode
        return {
            vendureTsConfig,
            rootTsConfig: vendureTsConfig,
            isMonorepo: false,
        };
    }

    // Find root tsconfig
    const rootTsConfig = findTsConfigInDir(monorepoInfo.root) || vendureTsConfig;

    return {
        vendureTsConfig,
        rootTsConfig,
        isMonorepo: true,
    };
}

export function getPluginClasses(project: Project) {
    const sourceFiles = project.getSourceFiles();

    const pluginClasses = sourceFiles
        .flatMap(sf => {
            return sf.getClasses();
        })
        .filter(c => {
            const hasPluginDecorator = c.getModifiers().find(m => {
                return Node.isDecorator(m) && m.getName() === 'VendurePlugin';
            });
            return !!hasPluginDecorator;
        });
    return pluginClasses;
}

export function addImportsToFile(
    sourceFile: SourceFile,
    options: {
        moduleSpecifier: string | SourceFile;
        namedImports?: string[];
        namespaceImport?: string;
        order?: number;
    },
) {
    const moduleSpecifier = getModuleSpecifierString(options.moduleSpecifier, sourceFile);
    const existingDeclaration = sourceFile.getImportDeclaration(
        declaration => declaration.getModuleSpecifier().getLiteralValue() === moduleSpecifier,
    );
    if (!existingDeclaration) {
        const importDeclaration = sourceFile.addImportDeclaration({
            moduleSpecifier,
            ...(options.namespaceImport ? { namespaceImport: options.namespaceImport } : {}),
            ...(options.namedImports ? { namedImports: options.namedImports } : {}),
        });
        if (options.order != null) {
            importDeclaration.setOrder(options.order);
        }
    } else {
        if (
            options.namespaceImport &&
            !existingDeclaration.getNamespaceImport() &&
            !existingDeclaration.getDefaultImport()
        ) {
            existingDeclaration.setNamespaceImport(options.namespaceImport);
        }
        if (options.namedImports) {
            const existingNamedImports = existingDeclaration.getNamedImports();
            for (const namedImport of options.namedImports) {
                if (!existingNamedImports.find(ni => ni.getName() === namedImport)) {
                    existingDeclaration.addNamedImport(namedImport);
                }
            }
        }
    }
}

function getModuleSpecifierString(moduleSpecifier: string | SourceFile, sourceFile: SourceFile): string {
    if (typeof moduleSpecifier === 'string') {
        return moduleSpecifier;
    }
    return getRelativeImportPath({ from: sourceFile, to: moduleSpecifier });
}

export function getRelativeImportPath(locations: {
    from: SourceFile | Directory;
    to: SourceFile | Directory;
}): string {
    const fromPath =
        locations.from instanceof SourceFile ? locations.from.getFilePath() : locations.from.getPath();
    const toPath = locations.to instanceof SourceFile ? locations.to.getFilePath() : locations.to.getPath();
    const fromDir = /\.[a-z]+$/.test(fromPath) ? path.dirname(fromPath) : fromPath;
    return convertPathToRelativeImport(path.relative(fromDir, toPath));
}

export function createFile(project: Project, templatePath: string, filePath: string) {
    const template = fs.readFileSync(templatePath, 'utf-8');
    try {
        const file = project.createSourceFile(filePath, template, {
            overwrite: true,
            scriptKind: ScriptKind.TS,
        });
        project.resolveSourceFileDependencies();
        return file;
    } catch (e: any) {
        log.error(e.message);
        process.exit(1);
    }
}

function convertPathToRelativeImport(filePath: string): string {
    // Normalize the path separators
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Remove the file extension
    const parsedPath = path.parse(normalizedPath);
    const prefix = parsedPath.dir.startsWith('..') ? '' : './';
    return `${prefix}${parsedPath.dir}/${parsedPath.name}`.replace(/\/\//g, '/');
}

export function customizeCreateUpdateInputInterfaces(sourceFile: SourceFile, entityRef: EntityRef) {
    const createInputInterface = sourceFile
        .getInterface('CreateEntityInput')
        ?.rename(`Create${entityRef.name}Input`);
    const updateInputInterface = sourceFile
        .getInterface('UpdateEntityInput')
        ?.rename(`Update${entityRef.name}Input`);

    let index = 0;
    for (const { name, type, nullable } of entityRef.getProps()) {
        if (
            type.isBoolean() ||
            type.isString() ||
            type.isNumber() ||
            (type.isObject() && type.getText() === 'Date')
        ) {
            createInputInterface?.insertProperty(index, {
                name,
                type: writer => writer.write(type.getText()),
                hasQuestionToken: nullable,
            });
            updateInputInterface?.insertProperty(index + 1, {
                name,
                type: writer => writer.write(type.getText()),
                hasQuestionToken: true,
            });
            index++;
        }
    }

    if (!entityRef.hasCustomFields()) {
        createInputInterface?.getProperty('customFields')?.remove();
        updateInputInterface?.getProperty('customFields')?.remove();
    }
    if (entityRef.isTranslatable()) {
        createInputInterface
            ?.getProperty('translations')
            ?.setType(`Array<TranslationInput<${entityRef.name}>>`);
        updateInputInterface
            ?.getProperty('translations')
            ?.setType(`Array<TranslationInput<${entityRef.name}>>`);
    } else {
        createInputInterface?.getProperty('translations')?.remove();
        updateInputInterface?.getProperty('translations')?.remove();
    }
}
