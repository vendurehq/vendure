import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

const createdRoots: string[] = [];

/**
 * Writes a throwaway project to a temp directory, one file per entry, and
 * returns its root. Remove the created projects with {@link removeProjectTrees}.
 */
export function createProjectTree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-project-'));
    createdRoots.push(root);
    for (const [relativePath, contents] of Object.entries(files)) {
        const fullPath = path.join(root, relativePath);
        fs.ensureDirSync(path.dirname(fullPath));
        fs.writeFileSync(fullPath, contents, 'utf8');
    }
    return root;
}

export function removeProjectTrees() {
    for (const root of createdRoots.splice(0)) {
        fs.removeSync(root);
    }
}

/**
 * A `package.json` and `index.js` for a package installed at `dir`.
 */
export function packageFiles(dir: string, name: string, indexJs: string): Record<string, string> {
    return {
        [`${dir}/package.json`]: JSON.stringify({ name, main: 'index.js' }),
        [`${dir}/index.js`]: indexJs,
    };
}
