import { randomUUID } from 'node:crypto';
import { Plugin } from 'vite';

/**
 * @description
 * Mixes a random value into every chunk hash, so a hashed JS file name is never
 * reused by a later build.
 *
 * Rollup hashes a chunk with the file names it imports replaced by placeholders,
 * so the hash does not record which chunk each import points to. The bug needs
 * two preconditions, both true for Dashboard extensions: sibling chunks share a
 * `[name]` (every extension chunk is `index`), and they import the entry back.
 * When the entry's dynamic imports of those chunks change order between builds,
 * the entry is renamed, but a sibling chunk can keep its file name while its
 * content now imports the new entry.
 *
 * The assets are served with `Cache-Control: immutable`, so after a redeploy a
 * browser or CDN can serve the old content under the reused name. It imports
 * the previous entry, which loads a second copy of React and crashes the app with
 * `Cannot read properties of null (reading 'useContext')`.
 *
 * See https://github.com/vendurehq/vendure/issues/5564
 */
export function chunkHashPlugin(): Plugin {
    return {
        name: 'vendure:chunk-hash',
        apply: 'build',
        augmentChunkHash: () => randomUUID(),
    };
}
