import { randomUUID } from 'node:crypto';
import { Plugin } from 'vite';

/**
 * @description
 * Mixes a value that is unique to each build into every chunk hash, so a hashed
 * JS file name is never reused by a later build.
 *
 * Rollup replaces the file names a chunk imports with placeholders before it
 * hashes the chunk, so the `[hash]` does not record which chunk each import
 * points to. The Dashboard entry imports every extension chunk, and the order
 * of those imports can differ between builds of identical source. Such a
 * reorder renames the entry, but an extension chunk that imports it can keep
 * its old file name while its content now points at the new entry.
 *
 * The Dashboard assets are served with `Cache-Control: immutable`. After a
 * redeploy a browser or CDN can then serve the old content under the reused
 * name. That content imports the previous entry file, which loads a second copy
 * of React and crashes the app with
 * `Cannot read properties of null (reading 'useContext')`.
 *
 * See https://github.com/vendurehq/vendure/issues/5564
 */
export function chunkHashPlugin(): Plugin {
    let buildId = randomUUID();
    return {
        name: 'vendure:chunk-hash',
        apply: 'build',
        buildStart() {
            // A new value per build, also when `vite build --watch` runs several builds in one process.
            buildId = randomUUID();
        },
        augmentChunkHash() {
            return buildId;
        },
    };
}
