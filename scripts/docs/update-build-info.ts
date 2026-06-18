/* eslint-disable no-console */
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

getLastCommitHash()
    .then(hash => writeBuildInfo(hash))
    .then(() => {
        console.log('Updated build info');
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

function writeBuildInfo(commitHash: string) {
    const corePackageJson = require('../../packages/core/package');
    const content = {
        version: corePackageJson.version,
        commit: commitHash,
    };
    return new Promise<void>((resolve, reject) => {
        fs.writeFile(
            path.join(__dirname, '../../docs/data/build.json'),
            JSON.stringify(content, null, 2),
            err => {
                if (err) {
                    reject(err);
                }
                resolve();
            },
        );
    });
}

function getLastCommitHash() {
    return new Promise<string>((resolve, reject) => {
        exec(`git log --pretty=format:'%h' -n 1`, (err, out) => {
            if (err) {
                reject(err);
            }
            resolve(out.replace(/'/g, ''));
        });
    });
}
