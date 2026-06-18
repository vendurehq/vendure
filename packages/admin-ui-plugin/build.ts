/* eslint-disable no-console */
import { execSync, spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

const compiledUiDir = path.join(__dirname, 'lib/admin-ui');
console.log('Building admin-ui from source...');

fs.removeSync(compiledUiDir);

const adminUiDir = path.join(__dirname, '../admin-ui');
const buildProcess = spawn('npm', ['run', 'build:app', `--prefix "${adminUiDir}"`], {
    cwd: adminUiDir,
    shell: true,
    stdio: 'inherit',
});

buildProcess.on('close', code => {
    if (code === 0) {
        fs.copySync(path.join(__dirname, '../admin-ui/dist'), compiledUiDir);
    } else {
        console.log('Could not build!');
        process.exitCode = 1;
    }
});
