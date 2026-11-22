import { createHash, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { LOCAL_TRUST_SECRET_ENV_VAR, LOCAL_TRUST_STATE_FILE, LocalTrustState } from './local-trust-contract';

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
    /** The project directory the state file is resolved against. */
    projectDir: string;
    /** The uid of this process. Undefined on platforms without uids, such as Windows. */
    uid: number | undefined;
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
 * 3. the CLI's state file exists in the project directory, is a regular file with mode 0600, is
 *    owned by this process's uid, and holds the same secret.
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
    const stateFile = path.resolve(input.projectDir, LOCAL_TRUST_STATE_FILE);
    if (input.uid === undefined) {
        return refused(
            `this platform has no file owner to check ${LOCAL_TRUST_STATE_FILE} against, so local ` +
                'trust is not supported on it',
        );
    }
    const state = readStateFile(stateFile, input.uid);
    if (typeof state === 'string') {
        return refused(state);
    }
    const secretHash = hashLocalTrustSecret(secret);
    if (!timingSafeEqual(secretHash, hashLocalTrustSecret(state.secret))) {
        return refused(`${stateFile} holds a different secret, so it belongs to another run of the CLI`);
    }
    return { enabled: true, secretHash, stateFile };
}

/** Returns the state, or the reason it cannot be used. */
function readStateFile(stateFile: string, uid: number): LocalTrustState | string {
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
        // The permission bits are the low nine bits of the mode.
        const mode = stats.mode % 0o1000;
        if (mode !== 0o600) {
            return `${stateFile} has mode ${mode.toString(8).padStart(4, '0')}, not 0600`;
        }
        if (stats.uid !== uid) {
            return `${stateFile} is owned by uid ${stats.uid}, not by this process (uid ${uid})`;
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
