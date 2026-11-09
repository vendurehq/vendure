import fs from 'fs-extra';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { ProjectLinkManifest } from './project-link-manifest';

/** The pattern Core accepts for a stored installation ID. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Console accepts only a version 4 UUID, which is what Core generates. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Records which Project Link sent which installation ID, so `status` and
 * `unlink` know about an attribution without asking Console. It is machine-local
 * and stays out of source control with the other `.vendure` files.
 */
const ATTRIBUTION_RELATIVE_PATH = path.join('.vendure', 'telemetry-attribution.json');

export interface TelemetryAttribution {
    linkId: string;
    installationId: string;
}

/**
 * The `VENDURE_DISABLE_TELEMETRY` opt-out that Core's telemetry service reads.
 * Core also turns telemetry off in CI. The CLI does not, so a link in CI can
 * attribute an installation that sends no telemetry.
 */
export function isTelemetryDisabled(env: NodeJS.ProcessEnv): boolean {
    const value = env.VENDURE_DISABLE_TELEMETRY?.toLowerCase();
    return value === 'true' || value === '1';
}

/**
 * Returns the Core telemetry installation ID of the project, and creates one
 * when there is none. Returns `undefined` when the file cannot be read or
 * written, or when it holds an ID that Console does not accept.
 *
 * Core's `InstallationIdCollector` keeps the ID in the database and in
 * `.vendure/.installation-id`. The CLI has no database connection, so it uses
 * the file. The server copies a file ID into an empty database at its next
 * start, so both use the same ID.
 */
export function ensureTelemetryInstallationId(projectRoot: string): string | undefined {
    const idPath = installationIdPath(projectRoot);
    try {
        if (fs.existsSync(idPath)) {
            const existing = fs.readFileSync(idPath, 'utf8').trim();
            if (UUID_PATTERN.test(existing)) {
                // Core keeps using this ID, so a new one would not match its telemetry.
                return UUID_V4_PATTERN.test(existing) ? existing : undefined;
            }
        }
        const id = randomUUID();
        fs.mkdirSync(path.dirname(idPath), { recursive: true });
        fs.writeFileSync(idPath, id, 'utf8');
        return id;
    } catch {
        return undefined;
    }
}

/**
 * The path Core's `InstallationIdCollector` uses when the server starts in
 * `projectRoot`: `.vendure/.installation-id` in the nearest directory that has
 * `node_modules`, or in `projectRoot` when there is none.
 */
function installationIdPath(projectRoot: string): string {
    let directory = projectRoot;
    while (directory !== path.dirname(directory)) {
        if (fs.existsSync(path.join(directory, 'node_modules'))) {
            return path.join(directory, '.vendure', '.installation-id');
        }
        directory = path.dirname(directory);
    }
    return path.join(projectRoot, '.vendure', '.installation-id');
}

/** The attribution of the current link, or `undefined` when this link did not send an installation ID. */
export function readTelemetryAttribution(
    projectRoot: string,
    manifest: ProjectLinkManifest,
): TelemetryAttribution | undefined {
    try {
        const value = fs.readJsonSync(path.join(projectRoot, ATTRIBUTION_RELATIVE_PATH)) as unknown;
        if (
            value &&
            typeof value === 'object' &&
            (value as TelemetryAttribution).linkId === manifest.link.id &&
            typeof (value as TelemetryAttribution).installationId === 'string' &&
            UUID_PATTERN.test((value as TelemetryAttribution).installationId)
        ) {
            return value as TelemetryAttribution;
        }
    } catch {
        // A missing or unreadable record means no attribution.
    }
    return undefined;
}

/** Returns `false` when the record cannot be written. */
export function writeTelemetryAttribution(projectRoot: string, attribution: TelemetryAttribution): boolean {
    try {
        fs.writeJsonSync(path.join(projectRoot, ATTRIBUTION_RELATIVE_PATH), attribution);
        return true;
    } catch {
        return false;
    }
}

export function removeTelemetryAttribution(projectRoot: string): void {
    fs.removeSync(path.join(projectRoot, ATTRIBUTION_RELATIVE_PATH));
}
