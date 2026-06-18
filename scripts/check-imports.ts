/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const find = require('find');

/**
 * An array of regular expressions defining illegal import patterns to be checked in the
 * source files of the monorepo packages. This prevents bad imports (which work locally
 * and go undetected) from getting into published releases of Vendure.
 */
const illegalImportPatterns: RegExp[] = [
    /@vendure\/common\/src/,
    /@vendure\/core\/src/,
    /@vendure\/admin-ui\/src/,
];

const exclude: string[] = [
    path.join(__dirname, '../packages/dev-server'),
];

findInFiles(illegalImportPatterns, path.join(__dirname, '../packages'), /\.ts$/, exclude);

function findInFiles(patterns: RegExp[], directory: string, fileFilter: RegExp, excludePaths: string[]) {
    find.file(fileFilter, directory, async (files: string[]) => {
        const nonNodeModulesFiles = files.filter(f => !f.includes('node_modules'));
        console.log(`Checking imports in ${nonNodeModulesFiles.length} files...`);
        const matches = await getMatchedFiles(patterns, nonNodeModulesFiles, excludePaths);
        if (matches.length) {
            console.error(`Found illegal imports in the following files:`);
            console.error(matches.join('\n'));
            process.exitCode = 1;
        } else {
            console.log('Imports check ok!');
        }
    });
}

async function getMatchedFiles(patterns: RegExp[], files: string[], excludePaths: string[]) {
    const matchedFiles = [];
    outer:
    for (let i = files.length - 1; i >= 0; i--) {
        for (const excludedPath of excludePaths) {
            if (files[i].includes(excludedPath)) {
                continue outer;
            }
        }
        const content = await readFile(files[i]);
        for (const pattern of patterns) {
            if (pattern.test(content)) {
                matchedFiles.push(files[i]);
                continue;
            }
        }
    }
    return matchedFiles;
}

function readFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf-8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}
