import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gql.tada/cli-utils', () => ({
    generateOutput: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/schema-generator.js', async () => {
    const { buildSchema } = await import('graphql');
    return {
        generateSchema: vi.fn().mockResolvedValue(buildSchema('type Query { ok: Boolean }')),
    };
});
vi.mock('../vite-plugin-config-loader.js', () => ({
    getConfigLoaderApi: () => ({
        getVendureConfig: () => Promise.resolve({ vendureConfig: {} }),
    }),
}));

import { gqlTadaPlugin } from '../vite-plugin-gql-tada.js';

const GRAPHQL_TS_SOURCE = 'export const graphql = "source";\n';
const OLD_TIME = new Date('2020-01-01T00:00:00Z');

async function runBuildStart(options: Parameters<typeof gqlTadaPlugin>[0]) {
    const plugin = gqlTadaPlugin(options);
    (plugin.configResolved as any).call({}, { plugins: [] });
    const context = {
        info: vi.fn(),
        error: vi.fn((message: string) => {
            throw new Error(message);
        }),
    };
    await (plugin.buildStart as any).call(context, {});
}

// `vendure dev` restarts the server and worker when src/gql/graphql.ts changes on disk.
// The gql.tada plugin must not rewrite it on every start when its content is unchanged.
describe('gqlTadaPlugin graphql.ts output', () => {
    let tmpRoot: string;
    let options: Parameters<typeof gqlTadaPlugin>[0];
    let targetPath: string;

    beforeEach(async () => {
        tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gql-tada-plugin-'));
        const packageRoot = path.join(tmpRoot, 'package');
        await fs.mkdir(path.join(packageRoot, 'src/lib/graphql'), { recursive: true });
        await fs.writeFile(path.join(packageRoot, 'src/lib/graphql/graphql.ts'), GRAPHQL_TS_SOURCE);
        const gqlTadaOutputPath = path.join(tmpRoot, 'project/src/gql');
        await fs.mkdir(gqlTadaOutputPath, { recursive: true });
        options = { packageRoot, gqlTadaOutputPath, tempDir: path.join(tmpRoot, 'temp') };
        targetPath = path.join(gqlTadaOutputPath, 'graphql.ts');
    });

    afterEach(async () => {
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    it('does not rewrite graphql.ts when its content is unchanged', async () => {
        await fs.writeFile(targetPath, GRAPHQL_TS_SOURCE);
        await fs.utimes(targetPath, OLD_TIME, OLD_TIME);

        await runBuildStart(options);

        const stat = await fs.stat(targetPath);
        expect(stat.mtime.getTime()).toBe(OLD_TIME.getTime());
        expect(await fs.readFile(targetPath, 'utf-8')).toBe(GRAPHQL_TS_SOURCE);
    });

    it('writes graphql.ts when it does not exist yet', async () => {
        await runBuildStart(options);

        expect(await fs.readFile(targetPath, 'utf-8')).toBe(GRAPHQL_TS_SOURCE);
    });

    it('overwrites graphql.ts when its content differs', async () => {
        await fs.writeFile(targetPath, 'export const graphql = "stale";\n');
        await fs.utimes(targetPath, OLD_TIME, OLD_TIME);

        await runBuildStart(options);

        expect(await fs.readFile(targetPath, 'utf-8')).toBe(GRAPHQL_TS_SOURCE);
        const stat = await fs.stat(targetPath);
        expect(stat.mtime.getTime()).not.toBe(OLD_TIME.getTime());
    });
});
