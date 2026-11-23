import {
    LOCAL_APP_DATA_ENV_VAR,
    LOCAL_TRUST_SECRET_ENV_VAR,
    LocalTrustState,
    localTrustStatePath,
} from '@vendure/common/lib/local-trust';
import { createHash, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Whether local trust is on for this server, decided once at startup. When it is on, only the
 * SHA-256 hash of the secret is kept, never the secret itself.
 */
export type LocalTrustActivation =
    | { enabled: true; secretHash: Buffer; stateFile: string }
    | {
          enabled: false;
          /**
           * Why a secret that was present in the environment was not accepted. Undefined when there
           * was no secret, which is the normal case for any server the CLI did not start.
           */
          refusedReason?: string;
      };

export const LOCAL_TRUST_OFF: LocalTrustActivation = { enabled: false };

export interface ReadLocalTrustActivationInput {
    /** The `localTrust` plugin option. */
    localTrust: boolean;
    /** The environment to read the secret from. The secret is deleted from it. */
    env: NodeJS.ProcessEnv;
    /** The project directory the state file belongs to. */
    projectDir: string;
    /** The uid of this process. Undefined on platforms without uids, such as Windows. */
    uid: number | undefined;
    /** The platform, which decides where the state file is and how it is checked. */
    platform: NodeJS.Platform;
    /**
     * Where the state file of the project is. Tests replace it to point at a fixture.
     *
     * @default localTrustStatePath
     */
    statePath?: (projectDir: string) => string;
}

export function hashLocalTrustSecret(secret: string): Buffer {
    return createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Reads the secret the Vendure CLI passed to this server, and turns local trust on only when every
 * startup guard holds:
 *
 * 1. the `localTrust` option is not `false`;
 * 2. the environment holds a non-empty secret;
 * 3. the CLI's state file holds the same secret. On macOS and Linux the file is
 *    `.vendure/devserver.json` in the project directory, and must be a regular file with mode 0600
 *    owned by this process's uid. On Windows, which has no file modes, the file is in the user
 *    profile, and its real path must be under the real path of the current user's `%LOCALAPPDATA%`,
 *    which only that user, SYSTEM and administrators can read.
 *
 * It always deletes the secret from the environment, so child processes and other plugins never
 * inherit it, even when local trust stays off.
 */
export function readLocalTrustActivation(input: ReadLocalTrustActivationInput): LocalTrustActivation {
    const secret = input.env[LOCAL_TRUST_SECRET_ENV_VAR];
    delete input.env[LOCAL_TRUST_SECRET_ENV_VAR];
    if (!secret) {
        return LOCAL_TRUST_OFF;
    }
    if (!input.localTrust) {
        return refused('the localTrust option is false');
    }
    const located = locateStateFile(input);
    if (typeof located === 'string') {
        return refused(located);
    }
    const { stateFile } = located;
    const state = readStateFile(stateFile, located.uid);
    if (typeof state === 'string') {
        return refused(state);
    }
    const secretHash = hashLocalTrustSecret(secret);
    if (!timingSafeEqual(secretHash, hashLocalTrustSecret(state.secret))) {
        return refused(`${stateFile} holds a different secret, so it belongs to another run of the CLI`);
    }
    return { enabled: true, secretHash, stateFile };
}

/**
 * Finds the state file, and on Windows checks that it is in the current user's profile. Returns
 * the file and, outside Windows, the uid that must own it, or the reason it cannot be used.
 */
function locateStateFile(
    input: ReadLocalTrustActivationInput,
): { stateFile: string; uid: number | undefined } | string {
    if (input.platform === 'win32') {
        return locateWindowsStateFile(input);
    }
    if (input.uid === undefined) {
        return 'this platform has no file owner to check the state file against, so local trust is not supported on it';
    }
    const statePath = input.statePath ?? (dir => localTrustStatePath(dir, { platform: input.platform }));
    return { stateFile: statePath(input.projectDir), uid: input.uid };
}

function locateWindowsStateFile(
    input: ReadLocalTrustActivationInput,
): { stateFile: string; uid: undefined } | string {
    const localAppData = input.env[LOCAL_APP_DATA_ENV_VAR];
    if (!localAppData) {
        return `${LOCAL_APP_DATA_ENV_VAR} is not set, so there is no user profile to keep the state file in`;
    }
    const statePath =
        input.statePath ?? (dir => localTrustStatePath(dir, { platform: input.platform, env: input.env }));
    const stateFile = statePath(input.projectDir);
    let realStateFile: string;
    let realLocalAppData: string;
    try {
        realStateFile = realpathSync.native(stateFile);
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        return code === 'ENOENT'
            ? `${stateFile} does not exist`
            : `${stateFile} could not be resolved (${code ?? String(e)})`;
    }
    try {
        realLocalAppData = realpathSync.native(localAppData);
    } catch (e) {
        return `${LOCAL_APP_DATA_ENV_VAR} (${localAppData}) could not be resolved (${(e as NodeJS.ErrnoException).code ?? String(e)})`;
    }
    // Real paths on both sides, so a junction or link out of the profile does not pass.
    if (!isInside(realLocalAppData, realStateFile)) {
        return (
            `${stateFile} resolves to ${realStateFile}, which is not under the current user's ` +
            `${LOCAL_APP_DATA_ENV_VAR} (${realLocalAppData})`
        );
    }
    return { stateFile: realStateFile, uid: undefined };
}

/** Whether `file` is inside `dir`. Windows paths ignore case. */
function isInside(dir: string, file: string): boolean {
    const relative = path.relative(dir.toLowerCase(), file.toLowerCase());
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Returns the state, or the reason it cannot be used. `uid` is undefined on Windows. */
function readStateFile(stateFile: string, uid: number | undefined): LocalTrustState | string {
    let fd: number;
    try {
        // O_NOFOLLOW: a symlink could point at a file someone else controls.
        // eslint-disable-next-line no-bitwise
        fd = openSync(stateFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        return code === 'ENOENT'
            ? `${stateFile} does not exist`
            : `${stateFile} could not be opened (${code ?? String(e)})`;
    }
    try {
        // Checked on the open descriptor, so the file cannot be swapped between the check and the read.
        const stats = fstatSync(fd);
        if (!stats.isFile()) {
            return `${stateFile} is not a regular file`;
        }
        // On Windows there are no modes or uids. The profile directory protects the file instead.
        if (uid !== undefined) {
            // The permission bits are the low nine bits of the mode.
            const mode = stats.mode % 0o1000;
            if (mode !== 0o600) {
                return `${stateFile} has mode ${mode.toString(8).padStart(4, '0')}, not 0600`;
            }
            if (stats.uid !== uid) {
                return `${stateFile} is owned by uid ${stats.uid}, not by this process (uid ${uid})`;
            }
        }
        return parseState(readFileSync(fd, 'utf8'), stateFile);
    } finally {
        closeSync(fd);
    }
}

function parseState(text: string, stateFile: string): LocalTrustState | string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return `${stateFile} is not valid JSON`;
    }
    const secret = (parsed as Partial<LocalTrustState> | null)?.secret;
    if (typeof secret !== 'string' || secret.length === 0) {
        return `${stateFile} holds no secret`;
    }
    return { secret };
}

function refused(reason: string): LocalTrustActivation {
    return { enabled: false, refusedReason: reason };
}
