import fs from 'fs-extra';
import path from 'node:path';

/**
 * Finds the nearest tsconfig by walking up from the given directory. In each
 * directory the candidates are checked in order, so earlier candidates take
 * precedence. Throws if none is found in any ancestor up to the filesystem root.
 */
export function findTsConfig(dir: string, candidates: string[] = ['tsconfig.json']): string {
    let currentDir = path.resolve(dir);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        for (const candidate of candidates) {
            const fullPath = path.join(currentDir, candidate);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            // Reached filesystem root without finding a tsconfig
            throw new Error(
                `No tsconfig.json found in ${dir} or any parent directory.\n` +
                    `Make sure you are running the codemod from a directory with a tsconfig.json, ` +
                    `or provide the path to the project directory as the second argument.`,
            );
        }
        currentDir = parentDir;
    }
}
