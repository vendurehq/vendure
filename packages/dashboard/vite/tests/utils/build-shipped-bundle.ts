import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Builds `dist/bundle` with `vite.lib.config.mts`, as it is published.
 *
 * NODE_ENV=production: Vitest sets NODE_ENV=test, which would otherwise make the bundle use the
 * development JSX runtime instead of the one that ships.
 */
export async function buildShippedBundle(packageRoot: string): Promise<void> {
    await execFileAsync('npm', ['run', 'build:lib'], {
        cwd: packageRoot,
        env: { ...process.env, NODE_ENV: 'production' },
    });
}
