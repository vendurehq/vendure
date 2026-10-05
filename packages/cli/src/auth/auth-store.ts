import {
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { SessionUnstorableError } from './auth-errors';
import { AuthOptions, getAuthFilePath, resolveClientId } from './auth-options';
import { errorCode } from './file-lock';

/** The WorkOS user the stored session belongs to. @since 3.8.0 */
export interface AuthUser {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
}

/**
 * The CLI login as it is written to `auth.json`.
 *
 * `clientId` records which WorkOS client issued the tokens. A file from another
 * client reads as no login, because its refresh token cannot be spent against
 * the configured one and its access token is verified against another issuer.
 */
export interface StoredAuth {
    version: 1;
    clientId: string;
    accessToken: string;
    refreshToken: string;
    user: AuthUser;
    /** The organization the session is scoped to, if any. */
    organization: StoredOrganization | null;
}

/**
 * The organization a session is scoped to. The Customer Account fields are
 * `null` when Console could not be asked at login; the WorkOS id is what scopes
 * the token.
 *
 * @since 3.8.0
 */
export interface StoredOrganization {
    workosOrganizationId: string;
    customerAccountId: string | null;
    name: string | null;
}

/** Returns the stored login for the configured client, or `undefined`. */
export function readStoredAuth(options: AuthOptions = {}): StoredAuth | undefined {
    const stored = readStoredAuthFile(options);
    return stored && stored.clientId === resolveClientId(options) ? stored : undefined;
}

/** Returns whatever login is on disk, whichever client issued it. */
export function readStoredAuthFile(options: AuthOptions = {}): StoredAuth | undefined {
    let raw: string;
    try {
        raw = readFileSync(getAuthFilePath(options), 'utf-8');
    } catch {
        return undefined;
    }
    try {
        return parseStoredAuth(JSON.parse(raw));
    } catch {
        return undefined;
    }
}

function parseStoredAuth(value: unknown): StoredAuth | undefined {
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.user)) {
        return undefined;
    }
    const { clientId, accessToken, refreshToken, user } = value;
    const organization = parseOrganization(value.organization);
    if (
        !nonEmpty(clientId) ||
        !nonEmpty(accessToken) ||
        !nonEmpty(refreshToken) ||
        organization === undefined ||
        !nonEmpty(user.id) ||
        typeof user.email !== 'string' ||
        !nullableString(user.firstName) ||
        !nullableString(user.lastName)
    ) {
        return undefined;
    }
    return {
        version: 1,
        clientId,
        accessToken,
        refreshToken,
        organization,
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
    };
}

function parseOrganization(value: unknown): StoredOrganization | null | undefined {
    if (value === null) {
        return null;
    }
    if (
        !isRecord(value) ||
        !nonEmpty(value.workosOrganizationId) ||
        !nullableString(value.customerAccountId) ||
        !nullableString(value.name)
    ) {
        return undefined;
    }
    return {
        workosOrganizationId: value.workosOrganizationId,
        customerAccountId: value.customerAccountId,
        name: value.name,
    };
}

/**
 * Write via a temp file and rename so the login is replaced atomically. A plain
 * write truncates in place: a crash mid-write leaves unparseable JSON, which
 * reads back as "not logged in" while the rotated refresh token, already spent
 * at WorkOS, is gone for good.
 */
export function writeStoredAuth(auth: StoredAuth, options: AuthOptions = {}): void {
    const file = getAuthFilePath(options);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tempFile = `${file}.${process.pid}.tmp`;
    try {
        writeFileSync(tempFile, serialize(auth), { mode: 0o600 });
        renameSync(tempFile, file);
    } catch (error) {
        removeQuietly(tempFile);
        throw error;
    }
    sweepStaleTempFiles(file);
}

export function clearStoredAuth(options: AuthOptions = {}): boolean {
    try {
        unlinkSync(getAuthFilePath(options));
        return true;
    } catch (error) {
        if (errorCode(error) === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

/**
 * A refresh token is single-use, so a write that fails after the exchange
 * leaves the spent token as the machine's only credential (CLO-703). An
 * exchange cannot be undone, so each one proves first that its result can be
 * stored.
 *
 * The probe writes and renames beside `auth.json`, never `auth.json` itself, and
 * removes itself. The filler is sized from the login being replaced.
 */
export function assertStorable(replacing: StoredAuth, options: AuthOptions = {}): void {
    const file = getAuthFilePath(options);
    const probeFile = `${file}.${process.pid}.probe.tmp`;
    const probeTarget = `${file}.${process.pid}.probed.tmp`;
    try {
        mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(probeFile, '0'.repeat(Buffer.byteLength(serialize(replacing))), { mode: 0o600 });
        renameSync(probeFile, probeTarget);
        unlinkSync(probeTarget);
    } catch {
        removeQuietly(probeFile);
        removeQuietly(probeTarget);
        throw new SessionUnstorableError(path.dirname(file));
    }
}

function serialize(auth: StoredAuth): string {
    return JSON.stringify(auth, null, 2);
}

/**
 * Long enough that no in-flight write can still be inside it: a temp file this
 * old belongs to a process killed between the write and the rename, and it
 * holds live tokens until something removes it.
 */
const STALE_TEMP_FILE_MS = 60 * 60 * 1000;

function sweepStaleTempFiles(file: string): void {
    const directory = path.dirname(file);
    const prefix = `${path.basename(file)}.`;
    const cutoff = Date.now() - STALE_TEMP_FILE_MS;
    let entries: string[];
    try {
        entries = readdirSync(directory);
    } catch {
        return;
    }
    for (const entry of entries) {
        if (!entry.startsWith(prefix) || !entry.endsWith('.tmp')) {
            continue;
        }
        const candidate = path.join(directory, entry);
        try {
            if (statSync(candidate).mtimeMs <= cutoff) {
                unlinkSync(candidate);
            }
        } catch {
            // Raced with its owner, or not ours to remove.
        }
    }
}

function removeQuietly(file: string): void {
    try {
        unlinkSync(file);
    } catch {
        // Never existed, or the directory that refused the write refuses this.
    }
}

function isRecord(value: unknown): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function nullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}
