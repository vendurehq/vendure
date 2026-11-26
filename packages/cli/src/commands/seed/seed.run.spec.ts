import type { VendureConfig } from '@vendure/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ConfigResolverFailedError,
    loadProjectConfigWith,
    loadSourceConfig,
} from '../../shared/load-project-config.js';
import { loadVendureConfigFromPath } from '../../shared/load-vendure-config-file.js';

import { loadSeedConfig } from './seed.run.js';

vi.mock('../../shared/load-project-config.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../shared/load-project-config.js')>()),
    loadProjectConfigWith: vi.fn(),
    loadSourceConfig: vi.fn(),
}));
vi.mock('../../shared/load-vendure-config-file.js', () => ({
    loadVendureConfigFromPath: vi.fn(),
}));

const resolved = { dbConnectionOptions: { type: 'postgres' } } as unknown as VendureConfig;
const fromFile = { dbConnectionOptions: { type: 'sqlite' } } as unknown as VendureConfig;

describe('loadSeedConfig()', () => {
    let dir: string;
    let ctx: { cwd: string; signal: AbortSignal };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-seed-config-'));
        fs.writeFileSync(
            path.join(dir, 'package.json'),
            JSON.stringify({ dependencies: { '@vendure/core': '*' } }),
        );
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(path.join(dir, 'src', 'vendure-config.ts'), 'export const config = {};');
        ctx = { cwd: dir, signal: new AbortController().signal };
        vi.mocked(loadVendureConfigFromPath).mockResolvedValue(fromFile);
        // No resolver returns a config, so the loader seed gives is called.
        vi.mocked(loadProjectConfigWith).mockImplementation((_options, loadFromSource) => loadFromSource());
    });

    afterEach(() => {
        vi.clearAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('asks the config resolvers before it loads src/vendure-config.ts', async () => {
        vi.mocked(loadProjectConfigWith).mockResolvedValueOnce({
            config: resolved,
            resolvedBy: '@acme/cloud',
            projectDir: dir,
        });

        expect(await loadSeedConfig(ctx, 'my-config.ts')).toBe(resolved);
        expect(loadProjectConfigWith).toHaveBeenCalledWith(
            { cwd: dir, projectDir: dir, configFile: 'my-config.ts', signal: ctx.signal },
            expect.any(Function),
        );
        expect(loadVendureConfigFromPath).not.toHaveBeenCalled();
    });

    it('loads src/vendure-config.ts directly when no resolver returns a config', async () => {
        expect(await loadSeedConfig(ctx)).toBe(fromFile);
        expect(loadVendureConfigFromPath).toHaveBeenCalledWith(path.join(dir, 'src', 'vendure-config.ts'));
        expect(loadSourceConfig).not.toHaveBeenCalled();
    });

    it('loads the config from the source when there is no config file', async () => {
        fs.rmSync(path.join(dir, 'src', 'vendure-config.ts'));
        vi.mocked(loadSourceConfig).mockResolvedValueOnce({ config: fromFile } as Awaited<
            ReturnType<typeof loadSourceConfig>
        >);

        expect(await loadSeedConfig(ctx)).toBe(fromFile);
        expect(loadVendureConfigFromPath).not.toHaveBeenCalled();
    });

    it('reports a failed resolver as config.resolver-failed, not seed.config-unreadable', async () => {
        vi.mocked(loadProjectConfigWith).mockRejectedValueOnce(
            new ConfigResolverFailedError({ plugin: '@acme/cloud', message: 'no handle' }),
        );

        expect(await loadSeedConfig(ctx)).toMatchObject({
            code: 'config.resolver-failed',
            details: { plugin: '@acme/cloud', message: 'no handle' },
        });
        expect(loadVendureConfigFromPath).not.toHaveBeenCalled();
    });

    it('rethrows when the command was cancelled, so the host reports it as cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        const aborted = new Error('This operation was aborted');
        vi.mocked(loadProjectConfigWith).mockRejectedValueOnce(aborted);

        await expect(loadSeedConfig({ cwd: dir, signal: controller.signal })).rejects.toBe(aborted);
    });
});
