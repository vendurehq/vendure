import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, Plugin, Rollup } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { chunkHashPlugin } from '../vite-plugin-chunk-hash.js';

const tempDirs: string[] = [];

/**
 * Writes a fixture where the entry dynamically imports two chunks that both
 * import the entry back, and every chunk file is named `index`. This mirrors the
 * Dashboard entry and its extension chunks.
 */
function writeFixture(importOrder: Array<'a' | 'b'>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vdb-chunk-hash-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'a'));
    fs.mkdirSync(path.join(root, 'b'));
    fs.writeFileSync(
        path.join(root, 'entry.js'),
        [`export const shared = 'shared';`, ...importOrder.map(name => `import('./${name}/index.js');`)].join(
            '\n',
        ),
    );
    fs.writeFileSync(
        path.join(root, 'a', 'index.js'),
        `import { shared } from '../entry.js';\nconsole.log('a', shared);\n`,
    );
    fs.writeFileSync(
        path.join(root, 'b', 'index.js'),
        `import { shared } from '../entry.js';\nconsole.log('b', shared.length);\n`,
    );
    return root;
}

async function buildFixture(root: string, plugins: Plugin[]): Promise<Rollup.OutputChunk[]> {
    const result = await build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins,
        build: {
            write: false,
            minify: false,
            rollupOptions: {
                input: path.join(root, 'entry.js'),
                // Pinned so both dynamic chunks are named `index` on every Rollup version.
                output: { chunkFileNames: 'assets/index-[hash].js' },
            },
        },
    });
    const outputs = Array.isArray(result) ? result : [result as Rollup.RollupOutput];
    return outputs.flatMap(o => o.output).filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
}

function jsFileNames(chunks: Rollup.OutputChunk[]): string[] {
    return chunks.map(c => c.fileName).filter(name => name.endsWith('.js'));
}

describe('chunkHashPlugin', () => {
    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    // #5564 — control: without the plugin, the bundler reuses a file name for different code.
    // If this fails, the bundler now hashes chunks differently and `chunkHashPlugin` may no longer be needed.
    it('reuses a file name for different code without the plugin', async () => {
        const first = await buildFixture(writeFixture(['a', 'b']), []);
        const second = await buildFixture(writeFixture(['b', 'a']), []);

        const reused = first.filter(chunk =>
            second.some(other => other.fileName === chunk.fileName && other.code !== chunk.code),
        );
        expect(reused.length).toBeGreaterThan(0);
    });

    // #5564 — a reordered dynamic import must not leave a chunk with the same file name and different content
    it('gives every JS chunk a new file name when the import order changes', async () => {
        const first = await buildFixture(writeFixture(['a', 'b']), [chunkHashPlugin()]);
        const second = await buildFixture(writeFixture(['b', 'a']), [chunkHashPlugin()]);

        const firstNames = jsFileNames(first);
        expect(firstNames).toHaveLength(3);
        expect(jsFileNames(second).filter(name => firstNames.includes(name))).toEqual([]);
    });

    // #5564 — two builds of identical source must not share a JS file name
    it('gives every JS chunk a new file name in a rebuild of identical source', async () => {
        const root = writeFixture(['a', 'b']);
        const first = await buildFixture(root, [chunkHashPlugin()]);
        const second = await buildFixture(root, [chunkHashPlugin()]);

        const firstNames = jsFileNames(first);
        expect(firstNames).toHaveLength(3);
        expect(jsFileNames(second).filter(name => firstNames.includes(name))).toEqual([]);
    });

    // The plugin must not drop chunks or break the imports between them.
    it('emits all chunks and the imports resolve to emitted file names', async () => {
        const chunks = await buildFixture(writeFixture(['a', 'b']), [chunkHashPlugin()]);
        const names = jsFileNames(chunks);
        expect(names).toHaveLength(3);

        const entry = chunks.find(c => c.isEntry);
        if (!entry) throw new Error('no entry chunk');
        expect(entry.dynamicImports).toHaveLength(2);
        for (const chunk of chunks) {
            for (const imported of [...chunk.imports, ...chunk.dynamicImports]) {
                expect(names).toContain(imported);
            }
        }
        for (const chunk of chunks.filter(c => !c.isEntry)) {
            expect(chunk.imports).toEqual([entry.fileName]);
            expect(chunk.code).toContain(path.basename(entry.fileName));
        }
    });
});
