import {
    buildCommandManifest,
    MANIFEST_FILE_NAME,
    MergedManifestCommand,
    mergeManifests,
    readManifestFile,
} from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Finds the manifest that ships with the CLI package. This file is in `dist/command-host`, and
 * the build writes the manifest to `dist`.
 */
export function coreManifestPath(): string {
    return path.join(import.meta.dirname, '..', MANIFEST_FILE_NAME);
}

/**
 * Loads the manifests that apply to the current project. It reads the CLI's own manifest.
 *
 * `build` writes the CLI's manifest, but `watch` does not. Without the file, the manifest is built
 * from the declarations instead, which loads their schemas and is slower.
 */
export async function loadMergedManifest(
    coreManifestFile: string = coreManifestPath(),
): Promise<MergedManifestCommand[]> {
    if (fs.existsSync(coreManifestFile)) {
        return mergeManifests([readManifestFile(coreManifestFile)]);
    }
    const { coreCommandDefinitions } = await import('./core-commands.js');
    const { name, version } = JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf-8'),
    ) as { name: string; version: string };
    return mergeManifests([await buildCommandManifest(name, version, coreCommandDefinitions)]);
}
