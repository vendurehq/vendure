import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { registerPaths, registerTsNode } = vi.hoisted(() => ({
    registerPaths: vi.fn(),
    registerTsNode: vi.fn(),
}));
vi.mock('tsconfig-paths', () => ({ register: registerPaths }));
vi.mock('ts-node', () => ({ register: registerTsNode }));

import { requireProjectModule } from './load-vendure-config-file.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-prepare-'));

function write(file: string, content: string) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
}

describe('requireProjectModule', () => {
    beforeEach(() => {
        registerPaths.mockClear();
    });
    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('registers the path mappings of a tsconfig once, and those of another tsconfig again', async () => {
        write(
            'tsconfig.base.json',
            JSON.stringify({ compilerOptions: { paths: { '@lib/*': ['./libs/*'] } } }),
        );
        write('apps/a/tsconfig.json', JSON.stringify({ extends: '../../tsconfig.base.json' }));
        write('apps/b/tsconfig.json', JSON.stringify({ extends: '../../tsconfig.base.json' }));
        const first = write('apps/a/first.js', 'module.exports = { value: 1 };');
        const second = write('apps/a/second.js', 'module.exports = { value: 2 };');
        const other = write('apps/b/other.js', 'module.exports = { value: 3 };');

        expect(await requireProjectModule(first)).toEqual({ value: 1 });
        expect(await requireProjectModule(second)).toEqual({ value: 2 });
        expect(registerPaths).toHaveBeenCalledTimes(1);
        // The mappings resolve against the tsconfig that declares them, not the one that extends it.
        expect(registerPaths).toHaveBeenCalledWith({ baseUrl: root, paths: { '@lib/*': ['./libs/*'] } });

        expect(await requireProjectModule(other)).toEqual({ value: 3 });
        expect(registerPaths).toHaveBeenCalledTimes(2);
    });

    it('uses only the paths of the derived tsconfig when both declare them', async () => {
        write(
            'tsconfig.shared.json',
            JSON.stringify({ compilerOptions: { paths: { '@base/*': ['./base/*'] } } }),
        );
        write(
            'apps/c/tsconfig.json',
            JSON.stringify({
                extends: '../../tsconfig.shared.json',
                compilerOptions: { paths: { '@own/*': ['./own/*'] } },
            }),
        );
        const file = write('apps/c/index.js', 'module.exports = {};');

        await requireProjectModule(file);
        expect(registerPaths).toHaveBeenCalledWith({
            baseUrl: path.join(root, 'apps', 'c'),
            paths: { '@own/*': ['./own/*'] },
        });
    });

    it('reads a tsconfig again after it failed to load', async () => {
        const tsconfig = write('apps/d/tsconfig.json', '{ not json');
        const file = write('apps/d/index.js', 'module.exports = {};');

        await expect(requireProjectModule(file)).rejects.toThrow(/Failed to parse TypeScript config/);
        fs.writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { paths: { '@d/*': ['./d/*'] } } }));
        await requireProjectModule(file);
        expect(registerPaths).toHaveBeenCalledTimes(1);
    });
});
