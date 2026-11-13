// @ts-check
const { posix } = require('node:path');

/**
 * Read access to the workspace. Paths are relative to the workspace root.
 * The Nx plugin reads the file system, the generators read an Nx `Tree`.
 *
 * @typedef {object} WorkspaceReader
 * @property {(path: string) => boolean} exists
 * @property {(path: string) => boolean} isFile
 * @property {(path: string) => string} read
 * @property {(path: string) => string[]} children
 */

/**
 * A Vendure plugin package that follows the package schema.
 * All paths except `root` are relative to the package root.
 *
 * @typedef {object} PluginPackage
 * @property {string} root
 * @property {string} dirName
 * @property {string} outDir First path segment of `main` in package.json, for example `lib`.
 * @property {'.' | 'src'} rootDir `src` when there is a `src/index.ts`, else `.` when there is an `index.ts`.
 * @property {string[]} entryFiles The files that `tsc` compiles for the build.
 * @property {boolean} hasUnitTests
 * @property {boolean} hasTypeTests
 * @property {boolean} hasE2e
 * @property {boolean} hasJsx True when there are `.tsx` files outside `src/dashboard`.
 * @property {boolean} hasDashboardConfig True when there is a `src/dashboard/tsconfig.json`.
 */

/** Files that mark a package as a Vendure plugin. Paths are relative to `src`. */
const PLUGIN_FILE = /^(plugin|[^/]+\.plugin|[^/]+\/plugin)\.ts$/;

/** The glob that the Nx plugin uses to find plugin files. */
const PLUGIN_FILE_GLOB = '**/src/{plugin.ts,*.plugin.ts,*/plugin.ts}';

const DEFAULT_OUT_DIR = 'lib';

/**
 * Returns the package root for a plugin file such as `packages/email-plugin/src/plugin.ts`,
 * or `undefined` when the file does not mark a plugin package.
 *
 * @param {string} file
 * @param {WorkspaceReader} reader
 * @returns {string | undefined}
 */
function getPackageRootForPluginFile(file, reader) {
    const match = /^(?:(.*)\/)?src\/(.+)$/.exec(file);
    if (!match || !PLUGIN_FILE.test(match[2])) {
        return undefined;
    }
    const root = match[1] ?? '';
    return reader.isFile(join(root, 'package.json')) ? root : undefined;
}

/**
 * @param {string} root
 * @param {WorkspaceReader} reader
 * @returns {boolean}
 */
function isPluginPackage(root, reader) {
    if (!reader.isFile(join(root, 'package.json')) || !reader.exists(join(root, 'src'))) {
        return false;
    }
    return listFiles(join(root, 'src'), reader, 2).some(file => PLUGIN_FILE.test(file));
}

/**
 * @param {string} root
 * @param {WorkspaceReader} reader
 * @returns {PluginPackage}
 */
function readPluginPackage(root, reader) {
    const packageJson = JSON.parse(reader.read(join(root, 'package.json')));
    const outDir = getOutDir(packageJson.main);
    // `src/index.ts` is the entry point of the schema. Older packages have `index.ts` in the package root.
    /** @type {'.' | 'src'} */
    const rootDir =
        reader.isFile(join(root, 'src/index.ts')) || !reader.isFile(join(root, 'index.ts')) ? 'src' : '.';
    const srcFiles = listFiles(join(root, 'src'), reader).map(file => `src/${file}`);
    const e2eFiles = reader.exists(join(root, 'e2e')) ? listFiles(join(root, 'e2e'), reader) : [];

    const entryFiles = new Set([rootDir === '.' ? 'index.ts' : 'src/index.ts']);
    for (const exportPath of getExportPaths(packageJson.exports)) {
        const sourceFile = toSourceFile(exportPath, outDir, rootDir);
        if (sourceFile && reader.isFile(join(root, sourceFile))) {
            entryFiles.add(sourceFile);
        }
    }
    // A sub-folder entry point, for example `src/bullmq/index.ts` for `@vendure/job-queue-plugin/package/bullmq`.
    for (const file of srcFiles) {
        if (/^src\/[^/]+\/index\.ts$/.test(file)) {
            entryFiles.add(file);
        }
    }

    return {
        root,
        dirName: posix.basename(root),
        outDir,
        rootDir,
        entryFiles: [...entryFiles],
        hasUnitTests: srcFiles.some(file => file.endsWith('.spec.ts')),
        hasTypeTests: srcFiles.some(file => file.endsWith('.spec-d.ts')),
        hasE2e: e2eFiles.some(file => file.endsWith('.e2e-spec.ts')),
        hasJsx: srcFiles.some(file => file.endsWith('.tsx') && !file.startsWith('src/dashboard/')),
        hasDashboardConfig: srcFiles.includes('src/dashboard/tsconfig.json'),
    };
}

/**
 * @param {unknown} main
 * @returns {string}
 */
function getOutDir(main) {
    if (typeof main !== 'string') {
        return DEFAULT_OUT_DIR;
    }
    const segments = posix.normalize(main).split('/');
    return segments.length > 1 ? segments[0] : DEFAULT_OUT_DIR;
}

/**
 * Collects the target paths of a package.json `exports` field.
 *
 * @param {unknown} exportsField
 * @returns {string[]}
 */
function getExportPaths(exportsField) {
    if (typeof exportsField === 'string') {
        return [exportsField];
    }
    if (exportsField && typeof exportsField === 'object') {
        return Object.values(exportsField).flatMap(value => getExportPaths(value));
    }
    return [];
}

/**
 * Maps `./dist/instrumentation.js` to `src/instrumentation.ts`.
 *
 * @param {string} exportPath
 * @param {string} outDir
 * @param {'.' | 'src'} rootDir
 * @returns {string | undefined}
 */
function toSourceFile(exportPath, outDir, rootDir) {
    const normalized = posix.normalize(exportPath);
    if (!normalized.startsWith(`${outDir}/`) || !normalized.endsWith('.js')) {
        return undefined;
    }
    const relative = normalized.slice(outDir.length + 1).replace(/\.js$/, '.ts');
    return rootDir === '.' ? relative : `src/${relative}`;
}

/**
 * Lists the files below `dir`, relative to `dir`.
 *
 * @param {string} dir
 * @param {WorkspaceReader} reader
 * @param {number} [maxDepth]
 * @returns {string[]}
 */
function listFiles(dir, reader, maxDepth = Infinity) {
    /** @type {string[]} */
    const files = [];
    /**
     * @param {string} relativeDir
     * @param {number} depth
     */
    const visit = (relativeDir, depth) => {
        for (const child of reader.children(join(dir, relativeDir))) {
            if (child === 'node_modules') {
                continue;
            }
            const relativePath = relativeDir ? `${relativeDir}/${child}` : child;
            if (reader.isFile(join(dir, relativePath))) {
                files.push(relativePath);
            } else if (depth < maxDepth) {
                visit(relativePath, depth + 1);
            }
        }
    };
    visit('', 1);
    return files.sort((a, b) => a.localeCompare(b));
}

/**
 * @param {...string} segments
 * @returns {string}
 */
function join(...segments) {
    return posix.join(...segments.filter(segment => segment !== ''));
}

module.exports = {
    PLUGIN_FILE_GLOB,
    getPackageRootForPluginFile,
    isPluginPackage,
    readPluginPackage,
};
