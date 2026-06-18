/* eslint-disable no-console */
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import * as fs from 'fs-extra';
import { globSync } from 'glob';
import * as path from 'path';

import {
    EXTENSION_ROUTES_FILE,
    GLOBAL_STYLES_OUTPUT_DIR,
    MODULES_OUTPUT_DIR,
    SHARED_EXTENSIONS_FILE,
} from './constants';
import { getAllTranslationFiles, mergeExtensionTranslations } from './translations';
import {
    AdminUiExtension,
    AdminUiExtensionLazyModule,
    AdminUiExtensionSharedModule,
    AdminUiExtensionWithId,
    Extension,
    GlobalStylesExtension,
    SassVariableOverridesExtension,
    StaticAssetExtension,
} from './types';
import {
    copyStaticAsset,
    copyUiDevkit,
    isAdminUiExtension,
    isGlobalStylesExtension,
    isSassVariableOverridesExtension,
    isStaticAssetExtension,
    isTranslationExtension,
    normalizeExtensions,
} from './utils';

export async function setupScaffold(outputPath: string, extensions: Extension[]) {
    deleteExistingExtensionModules(outputPath);

    const adminUiExtensions = extensions.filter((e): e is AdminUiExtension => isAdminUiExtension(e));
    const normalizedExtensions = normalizeExtensions(adminUiExtensions);

    const modulePathMapping = generateModulePathMapping(normalizedExtensions);
    copyAdminUiSource(outputPath, modulePathMapping);

    await copyExtensionModules(outputPath, normalizedExtensions);

    const staticAssetExtensions = extensions.filter(isStaticAssetExtension);
    await copyStaticAssets(outputPath, staticAssetExtensions);

    const globalStyleExtensions = extensions.filter(isGlobalStylesExtension);
    const sassVariableOverridesExtension = extensions.find(isSassVariableOverridesExtension);
    await addGlobalStyles(outputPath, globalStyleExtensions, sassVariableOverridesExtension);

    const allTranslationFiles = getAllTranslationFiles(extensions.filter(isTranslationExtension));
    await mergeExtensionTranslations(outputPath, allTranslationFiles);

    copyUiDevkit(outputPath);
}

/**
 * Deletes the contents of the /modules directory, which contains the plugin
 * extension modules copied over during the last compilation.
 */
function deleteExistingExtensionModules(outputPath: string) {
    fs.removeSync(path.join(outputPath, MODULES_OUTPUT_DIR));
}

/**
 * Generates a module path mapping object for all extensions with a "pathAlias"
 * property declared (if any).
 */
function generateModulePathMapping(extensions: AdminUiExtensionWithId[]) {
    const extensionsWithAlias = extensions.filter(e => e.pathAlias);
    if (extensionsWithAlias.length === 0) {
        return undefined;
    }

    return extensionsWithAlias.reduce((acc, e) => {
        // for imports from the index file if there is one
        acc[e.pathAlias as string] = [`src/extensions/${e.id}`];
        // direct access to files / deep imports
        acc[`${e.pathAlias as string}/*`] = [`src/extensions/${e.id}/*`];
        return acc;
    }, {} as Record<string, string[]>);
}

/**
 * Copies all files from the extensionPaths of the configured extensions into the
 * admin-ui source tree.
 */
async function copyExtensionModules(outputPath: string, extensions: AdminUiExtensionWithId[]) {
    const adminUiExtensions = extensions.filter(isAdminUiExtension);
    const extensionRoutesSource = generateLazyExtensionRoutes(adminUiExtensions);
    fs.writeFileSync(path.join(outputPath, EXTENSION_ROUTES_FILE), extensionRoutesSource, 'utf8');
    const sharedExtensionModulesSource = generateSharedExtensionModule(extensions);
    fs.writeFileSync(path.join(outputPath, SHARED_EXTENSIONS_FILE), sharedExtensionModulesSource, 'utf8');

    for (const extension of adminUiExtensions) {
        if (!extension.extensionPath) {
            continue;
        }
        const dest = path.join(outputPath, MODULES_OUTPUT_DIR, extension.id);
        if (!extension.exclude) {
            fs.copySync(extension.extensionPath, dest);
            continue;
        }

        const exclude =
            extension.exclude?.map(e => globSync(path.join(extension.extensionPath, e))).flatMap(e => e) ??
            [];
        fs.copySync(extension.extensionPath, dest, {
            filter: name => name === extension.extensionPath || exclude.every(e => e !== name),
        });
    }
}

async function copyStaticAssets(outputPath: string, extensions: Array<Partial<StaticAssetExtension>>) {
    for (const extension of extensions) {
        if (Array.isArray(extension.staticAssets)) {
            for (const asset of extension.staticAssets) {
                await copyStaticAsset(outputPath, asset);
            }
        }
    }
}

async function addGlobalStyles(
    outputPath: string,
    globalStylesExtensions: GlobalStylesExtension[],
    sassVariableOverridesExtension?: SassVariableOverridesExtension,
) {
    const globalStylesDir = path.join(outputPath, 'src', GLOBAL_STYLES_OUTPUT_DIR);
    await fs.remove(globalStylesDir);
    await fs.ensureDir(globalStylesDir);

    const imports: string[] = [];
    for (const extension of globalStylesExtensions) {
        const styleFiles = Array.isArray(extension.globalStyles)
            ? extension.globalStyles
            : [extension.globalStyles];
        for (const styleFile of styleFiles) {
            await copyGlobalStyleFile(outputPath, styleFile);
            imports.push(path.basename(styleFile, path.extname(styleFile)));
        }
    }

    let overridesImport = '';
    if (sassVariableOverridesExtension) {
        const overridesFile = sassVariableOverridesExtension.sassVariableOverrides;
        await copyGlobalStyleFile(outputPath, overridesFile);
        overridesImport = `@import "./${GLOBAL_STYLES_OUTPUT_DIR}/${path.basename(
            overridesFile,
            path.extname(overridesFile),
        )}";\n`;
    }

    const globalStylesSource =
        overridesImport +
        '@import "./styles/styles";\n' +
        imports.map(file => `@import "./${GLOBAL_STYLES_OUTPUT_DIR}/${file}";`).join('\n');

    const globalStylesFile = path.join(outputPath, 'src', 'global-styles.scss');
    await fs.writeFile(globalStylesFile, globalStylesSource, 'utf-8');
}

export async function copyGlobalStyleFile(outputPath: string, stylePath: string) {
    const globalStylesDir = path.join(outputPath, 'src', GLOBAL_STYLES_OUTPUT_DIR);
    const fileBasename = path.basename(stylePath);
    const styleOutputPath = path.join(globalStylesDir, fileBasename);
    await fs.copyFile(stylePath, styleOutputPath);
}

function generateLazyExtensionRoutes(extensions: AdminUiExtensionWithId[]): string {
    const routes: string[] = [];
    for (const extension of extensions) {
        for (const module of extension.ngModules ?? []) {
            if (module.type === 'lazy') {
                routes.push(`  {
    path: 'extensions/${module.route}',
    loadChildren: () => import('${getModuleFilePath(extension.id, module)}').then(m => m.${
                    module.ngModuleName
                }),
  }`);
            }
        }
        for (const route of extension.routes ?? []) {
            const prefix = route.prefix === '' ? '' : `${route.prefix ?? 'extensions'}/`;
            routes.push(`  {
    path: '${prefix}${route.route}',
    loadChildren: () => import('./extensions/${extension.id}/${path.basename(route.filePath, '.ts')}'),
  }`);
        }
    }
    return `export const extensionRoutes = [${routes.join(',\n')}];\n`;
}

function generateSharedExtensionModule(extensions: AdminUiExtensionWithId[]) {
    const adminUiExtensions = extensions.filter(isAdminUiExtension);
    const moduleImports = adminUiExtensions
        .map(e =>
            e.ngModules
                ?.filter(m => m.type === 'shared')
                .map(m => `import { ${m.ngModuleName} } from '${getModuleFilePath(e.id, m)}';\n`)
                .join(''),
        )
        .filter(val => !!val)
        .join('');
    const providerImports = adminUiExtensions
        .map((m, i) =>
            (m.providers ?? [])
                .map(
                    (f, j) =>
                        `import SharedProviders_${i}_${j} from './extensions/${m.id}/${path.basename(
                            f,
                            '.ts',
                        )}';\n`,
                )
                .join(''),
        )
        .filter(val => !!val)
        .join('');
    const modules = adminUiExtensions
        .map(e =>
            e.ngModules
                ?.filter(m => m.type === 'shared')
                .map(m => m.ngModuleName)
                .join(', '),
        )
        .filter(val => !!val)
        .join(', ');
    const providers = adminUiExtensions
        .filter(notNullOrUndefined)
        .map((m, i) => (m.providers ?? []).map((f, j) => `...SharedProviders_${i}_${j}`).join(', '))
        .filter(val => !!val)
        .join(', ');
    return `import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
${moduleImports}
${providerImports}

@NgModule({
    imports: [CommonModule, ${modules}],
    providers: [${providers}],
})
export class SharedExtensionsModule {}
`;
}

function getModuleFilePath(
    id: string,
    module: AdminUiExtensionLazyModule | AdminUiExtensionSharedModule,
): string {
    return `./extensions/${id}/${path.basename(module.ngModuleFileName, '.ts')}`;
}

/**
 * Copies the Admin UI sources & static assets to the outputPath if it does not already
 * exist there.
 */
function copyAdminUiSource(outputPath: string, modulePathMapping: Record<string, string[]> | undefined) {
    const tsconfigFilePath = path.join(outputPath, 'tsconfig.json');
    const indexFilePath = path.join(outputPath, '/src/index.html');
    if (fs.existsSync(tsconfigFilePath) && fs.existsSync(indexFilePath)) {
        configureModulePathMapping(tsconfigFilePath, modulePathMapping);
        return;
    }

    const scaffoldDir = path.join(__dirname, '../scaffold');
    const adminUiSrc = path.join(require.resolve('@vendure/admin-ui'), '../../static');

    if (!fs.existsSync(scaffoldDir)) {
        throw new Error(`Could not find the admin ui scaffold files at ${scaffoldDir}`);
    }
    if (!fs.existsSync(adminUiSrc)) {
        throw new Error(`Could not find the @vendure/admin-ui sources. Looked in ${adminUiSrc}`);
    }

    // copy scaffold
    fs.removeSync(outputPath);
    fs.ensureDirSync(outputPath);
    fs.copySync(scaffoldDir, outputPath);
    configureModulePathMapping(tsconfigFilePath, modulePathMapping);

    // copy source files from admin-ui package
    const outputSrc = path.join(outputPath, 'src');
    fs.ensureDirSync(outputSrc);
    fs.copySync(adminUiSrc, outputSrc);
}

export async function setBaseHref(outputPath: string, baseHref: string) {
    const angularJsonFilePath = path.join(outputPath, '/angular.json');
    const angularJson = await fs.readJSON(angularJsonFilePath, 'utf-8');
    angularJson.projects['vendure-admin'].architect.build.options.baseHref = baseHref;
    await fs.writeJSON(angularJsonFilePath, angularJson, { spaces: 2 });
}

/**
 * Adds module path mapping to the bundled tsconfig.json file if defined as a UI extension.
 */
function configureModulePathMapping(
    tsconfigFilePath: string,
    modulePathMapping: Record<string, string[]> | undefined,
) {
    if (!modulePathMapping) {
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tsconfig = require(tsconfigFilePath);
    tsconfig.compilerOptions.paths = modulePathMapping;
    fs.writeFileSync(tsconfigFilePath, JSON.stringify(tsconfig, null, 2));
}
