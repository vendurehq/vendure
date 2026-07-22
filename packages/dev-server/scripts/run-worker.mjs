import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquireWorkerLock } from './worker-lock.mjs';

const devServerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.resolve(devServerDir, '../cli/dist/cli.js');
const instrumented = process.argv.includes('--instrumented');
let lock;
try {
    lock = acquireWorkerLock({ cwd: devServerDir });
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

const args = instrumented
    ? [
          '-r',
          'ts-node/register',
          '-r',
          'dotenv/config',
          '-r',
          'tsconfig-paths/register',
          '-r',
          './instrumentation.ts',
          './index-worker.ts',
      ]
    : [cliPath, 'dev', 'worker', '--worker-entry', './index-worker.ts'];

const child = spawn(process.execPath, args, {
    cwd: devServerDir,
    env: {
        ...process.env,
        ...(instrumented ? { IS_INSTRUMENTED: 'true' } : {}),
    },
    stdio: 'inherit',
});

let shuttingDown = false;

function stop(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

child.once('error', error => {
    console.error(error);
    lock.release();
    process.exitCode = 1;
});

child.once('close', (code, signal) => {
    lock.release();
    if (signal === 'SIGINT') {
        process.exitCode = 130;
    } else if (signal === 'SIGTERM') {
        process.exitCode = 143;
    } else {
        process.exitCode = code ?? 1;
    }
});
