/*
 * The local-trust contract between `vendure dev` and the server it starts.
 *
 * Each `vendure dev` run generates one secret. It passes the secret to the server child
 * in the {@link LOCAL_TRUST_SECRET_ENV_VAR} environment variable, and writes it to the state
 * file at {@link localTrustStatePath}. The server accepts the secret only when the file exists
 * and holds the same secret.
 *
 * {@link localTrustStatePath} uses `node:fs` and `node:crypto`, so this module runs only in Node.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * The name of the environment variable in which `vendure dev` passes the secret of the
 * current run to the server child.
 */
export const LOCAL_TRUST_SECRET_ENV_VAR = 'VENDURE_LOCAL_TRUST_SECRET';

/**
 * The environment variable that names the current user's local application data directory on
 * Windows, which holds the state files there.
 */
export const LOCAL_APP_DATA_ENV_VAR = 'LOCALAPPDATA';

/**
 * The part of the state file which the server reads to check a local-trust secret. The
 * file holds more fields, which are written and read by `@vendure/cli`.
 */
export interface LocalTrustState {
    /**
     * The secret of the current `vendure dev` run.
     */
    secret: string;
}

/**
 * What {@link localTrustStatePath} reads from the process. Tests pass their own values.
 */
export interface LocalTrustStatePathOptions {
    /** @default process.platform */
    platform?: NodeJS.Platform;
    /** @default process.env */
    env?: Record<string, string | undefined>;
    /**
     * Resolves the project directory to its real path. A directory that cannot be resolved, for
     * example because it does not exist, is used as given.
     *
     * @default fs.realpathSync.native
     */
    realpath?: (dir: string) => string;
}

/**
 * Thrown by {@link localTrustStatePath} on Windows when `LOCALAPPDATA` is not set, so there is no
 * user profile directory to keep the state file in.
 */
export class LocalAppDataNotSetError extends Error {
    constructor() {
        super(
            `${LOCAL_APP_DATA_ENV_VAR} is not set, so there is no user profile directory for the ` +
                'local-trust state file.',
        );
        this.name = 'LocalAppDataNotSetError';
    }
}

/**
 * The absolute path of the state file of `vendure dev` runs for a project.
 *
 * - On macOS and Linux it is `<projectDir>/.vendure/devserver.json`. The file has mode 0600, so
 *   only its owner can read it.
 * - On Windows, which has no file modes, it is
 *   `%LOCALAPPDATA%\Vendure\devserver\<hash>.json`, in the user profile. The file takes the
 *   permissions of that directory, which by default only the user, SYSTEM and administrators can
 *   read. Nothing checks them. `<hash>` is the first 16 hex characters of the SHA-256 of
 *   the project directory's real path, in lower case, so each worktree gets its own file and two
 *   spellings of one directory get the same file.
 *
 * Throws {@link LocalAppDataNotSetError} on Windows when `LOCALAPPDATA` is not set.
 */
export function localTrustStatePath(projectDir: string, options: LocalTrustStatePathOptions = {}): string {
    const platform = options.platform ?? process.platform;
    if (platform !== 'win32') {
        return path.resolve(projectDir, '.vendure', 'devserver.json');
    }
    const localAppData = (options.env ?? process.env)[LOCAL_APP_DATA_ENV_VAR];
    if (!localAppData) {
        throw new LocalAppDataNotSetError();
    }
    const realProjectDir = resolveRealPath(projectDir, options.realpath ?? realpathSync.native);
    // NTFS ignores case, so C:\Shop and c:\shop are one directory and must share one file.
    const hash = createHash('sha256').update(realProjectDir.toLowerCase()).digest('hex').slice(0, 16);
    return path.win32.join(localAppData, 'Vendure', 'devserver', `${hash}.json`);
}

function resolveRealPath(dir: string, realpath: (dir: string) => string): string {
    try {
        return realpath(dir);
    } catch {
        return dir;
    }
}
