import { LOCAL_TRUST_SECRET_ENV_VAR, LOCAL_TRUST_STATE_FILE } from '@vendure/common/lib/local-trust';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A project directory as the Vendure CLI leaves it while a dev server runs: `.vendure/devserver.json`
 * with mode 0600, holding the run's secret. The plugin reads it from the server's working directory.
 */
export function createLocalTrustProject(stateFile?: { secret: string; mode?: number }): {
    projectDir: string;
    remove: () => void;
} {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'mcp-local-trust-e2e-'));
    if (stateFile) {
        const file = path.join(projectDir, LOCAL_TRUST_STATE_FILE);
        mkdirSync(path.dirname(file), { recursive: true });
        const mode = stateFile.mode ?? 0o600;
        writeFileSync(
            file,
            JSON.stringify({ secret: stateFile.secret, urls: { admin: 'http://localhost/admin-api' } }),
            { mode },
        );
        // The mode passed to writeFileSync is masked by the umask, so it is set again.
        chmodSync(file, mode);
    }
    return { projectDir, remove: () => rmSync(projectDir, { recursive: true, force: true }) };
}

/**
 * Starts a server the way the CLI does: the secret in the environment and the project directory as
 * the working directory. The plugin reads both while the server boots, so the working directory is
 * put back as soon as `start` resolves.
 */
export async function startAsDevServer(
    start: () => Promise<void>,
    options: { projectDir: string; secret?: string },
): Promise<void> {
    const originalCwd = process.cwd();
    if (options.secret !== undefined) {
        process.env[LOCAL_TRUST_SECRET_ENV_VAR] = options.secret;
    }
    process.chdir(options.projectDir);
    try {
        await start();
    } finally {
        process.chdir(originalCwd);
        delete process.env[LOCAL_TRUST_SECRET_ENV_VAR];
    }
}

/** POSTs a GraphQL query to the Admin API with the given headers, as `vendure api admin` does. */
export async function postAdminApi(
    adminApiUrl: string,
    query: string,
    headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
    const response = await fetch(adminApiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ query }),
    });
    return { status: response.status, body: await response.json() };
}

/**
 * POSTs a JSON body with exactly the given headers over `node:http`. `fetch` always sets `Host`
 * from the URL, so a request naming another host, as after DNS rebinding, needs this instead.
 */
export function postRaw(
    port: number,
    urlPath: string,
    headers: Record<string, string>,
    body: unknown,
): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
        const req = request(
            {
                host: '127.0.0.1',
                port,
                path: urlPath,
                method: 'POST',
                headers: { 'content-type': 'application/json', ...headers },
            },
            res => {
                res.resume();
                res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
            },
        );
        req.on('error', reject);
        req.end(JSON.stringify(body));
    });
}
