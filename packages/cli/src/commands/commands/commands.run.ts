import { loadMergedManifest } from '../../command-host/manifest.js';

/** The merged manifest for the current project. */
export async function run() {
    return { commands: loadMergedManifest() };
}
