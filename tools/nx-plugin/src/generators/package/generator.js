// @ts-check
const { formatFiles, generateFiles, names, readJson } = require('@nx/devkit');
const { join, posix } = require('node:path');

const { readPluginPackage } = require('../../package-schema');
const { getTsconfigFiles, readRootLib } = require('../sync-tsconfig/generator');

/**
 * Creates a Vendure plugin package in `packages/<name>` that follows the package schema.
 * The package has no build configuration: the Nx plugin creates its targets, and the
 * tsconfig files come from the same code as `nx sync`.
 *
 * @param {import('@nx/devkit').Tree} tree
 * @param {{ name: string }} options
 */
async function packageGenerator(tree, options) {
    const root = posix.join('packages', options.name);
    if (tree.exists(root)) {
        throw new Error(`${root} already exists`);
    }
    const baseName = options.name.replace(/-plugin$/, '');
    const version = readJson(tree, 'packages/core/package.json').version;
    generateFiles(tree, join(__dirname, 'files'), root, {
        ...names(baseName),
        packageName: `@vendure/${options.name}`,
        dirName: options.name,
        version,
        majorVersion: version.split('.')[0],
        template: '',
    });
    await formatFiles(tree);

    // Written after `formatFiles`, so that they are exactly what `nx sync` writes.
    const pkg = readPluginPackage(root, {
        exists: path => tree.exists(path),
        isFile: path => tree.isFile(path),
        read: path => tree.read(path, 'utf-8') ?? '',
        children: path => tree.children(path),
    });
    for (const [fileName, content] of Object.entries(await getTsconfigFiles(pkg, readRootLib(tree)))) {
        if (content !== undefined) {
            tree.write(posix.join(root, fileName), content);
        }
    }
}

module.exports = packageGenerator;
module.exports.default = packageGenerator;
