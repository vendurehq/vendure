// @ts-check
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { join, posix } = require('node:path');

const { getPackageRootForPluginFile, PLUGIN_FILE_GLOB, readPluginPackage } = require('./package-schema');

/**
 * @typedef {import('@nx/devkit').TargetConfiguration} TargetConfiguration
 * @typedef {import('./package-schema').PluginPackage} PluginPackage
 * @typedef {import('./package-schema').WorkspaceReader} WorkspaceReader
 */

/** The Vitest config of the `test` target. The path is relative to the workspace root. */
const UNIT_TEST_CONFIG = 'tools/nx-plugin/vitest.package.config.mts';
/** The Vitest config of the `e2e` target. The path is relative to the workspace root. */
const E2E_TEST_CONFIG = 'e2e-common/vitest.config.mts';
/** The name of the project of this plugin. */
const NX_PLUGIN_PROJECT = 'nx-plugin';

/**
 * Finds Vendure plugin packages by their folder structure and adds their targets.
 * A target is only added when the files it works on exist.
 *
 * The targets only set the command. The `targetDefaults` in nx.json set `dependsOn`,
 * `inputs`, `outputs`, `cache` and `continuous`, because they take precedence over
 * the values of an inferred target.
 *
 * Each project depends on this plugin, so that `nx affected` includes the plugin
 * packages when the plugin or its shared Vitest config changes.
 *
 * @type {import('@nx/devkit').CreateNodesV2}
 */
const createNodesV2 = [
    PLUGIN_FILE_GLOB,
    (pluginFiles, _options, context) => {
        const reader = createFsReader(context.workspaceRoot);
        // A package can have more than one plugin file. Use the first one for each package.
        /** @type {Map<string, string>} */
        const fileByRoot = new Map();
        for (const file of pluginFiles) {
            const root = getPackageRootForPluginFile(file, reader);
            if (root !== undefined && !fileByRoot.has(root)) {
                fileByRoot.set(root, file);
            }
        }
        return [...fileByRoot].map(([root, file]) => [
            file,
            {
                projects: {
                    [root]: {
                        root,
                        implicitDependencies: [NX_PLUGIN_PROJECT],
                        targets: createTargets(readPluginPackage(root, reader)),
                    },
                },
            },
        ]);
    },
];

/**
 * @param {PluginPackage} pkg
 * @returns {Record<string, TargetConfiguration>}
 */
function createTargets(pkg) {
    const toWorkspaceRoot = posix.relative(pkg.root, '.') || '.';
    /** @param {string} command */
    const runCommand = command => ({
        executor: 'nx:run-commands',
        options: { command, cwd: '{projectRoot}' },
    });

    /** @type {Record<string, TargetConfiguration>} */
    const targets = {
        build: runCommand(`rimraf ${pkg.outDir} && tsc -p ./tsconfig.build.json`),
        watch: runCommand('tsc -p ./tsconfig.build.json --watch'),
        lint: runCommand('eslint --fix .'),
    };
    if (pkg.hasUnitTests) {
        const typecheck = pkg.hasTypeTests ? ' --typecheck' : '';
        targets.test = runCommand(`vitest --config ${toWorkspaceRoot}/${UNIT_TEST_CONFIG} --run${typecheck}`);
    }
    if (pkg.hasE2e) {
        targets.e2e = runCommand(
            `cross-env PACKAGE=${pkg.dirName} vitest --config ${toWorkspaceRoot}/${E2E_TEST_CONFIG} --run`,
        );
    }
    return targets;
}

/**
 * @param {string} workspaceRoot
 * @returns {WorkspaceReader}
 */
function createFsReader(workspaceRoot) {
    /** @param {string} path */
    const abs = path => join(workspaceRoot, path);
    return {
        exists: path => existsSync(abs(path)),
        isFile: path => existsSync(abs(path)) && statSync(abs(path)).isFile(),
        read: path => readFileSync(abs(path), 'utf-8'),
        children: path => (existsSync(abs(path)) ? readdirSync(abs(path)) : []),
    };
}

module.exports = { createNodesV2, createTargets };
