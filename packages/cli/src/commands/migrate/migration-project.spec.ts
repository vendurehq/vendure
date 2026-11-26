import type { VendureConfig } from '@vendure/core';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigResolverFailedError, loadProjectConfig } from '../../shared/load-project-config.js';

import { defaultMigrationDir, openMigrationProject } from './migration-project.js';

vi.mock('../../shared/load-project-config.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../shared/load-project-config.js')>()),
    loadProjectConfig: vi.fn(),
}));

const config = { dbConnectionOptions: { type: 'postgres' } } as unknown as VendureConfig;

describe('openMigrationProject()', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns a config from a config resolver, and passes the signal on', async () => {
        vi.mocked(loadProjectConfig).mockResolvedValueOnce({ config, resolvedBy: '@acme/cloud' });
        const signal = new AbortController().signal;

        expect(await openMigrationProject('my-config.ts', signal)).toEqual({
            config,
            resolvedBy: '@acme/cloud',
        });
        expect(loadProjectConfig).toHaveBeenCalledWith({ configFile: 'my-config.ts', signal });
    });

    it('reports a failed config resolver as config.resolver-failed', async () => {
        vi.mocked(loadProjectConfig).mockRejectedValueOnce(
            new ConfigResolverFailedError({ plugin: '@acme/cloud', message: 'no handle' }),
        );

        expect(await openMigrationProject()).toMatchObject({
            code: 'config.resolver-failed',
            details: { plugin: '@acme/cloud', message: 'no handle' },
        });
    });

    it('reports any other failure as migrate.config-unreadable', async () => {
        vi.mocked(loadProjectConfig).mockRejectedValueOnce(new Error('no VendureConfig found'));

        expect(await openMigrationProject()).toMatchObject({
            code: 'migrate.config-unreadable',
        });
    });
});

describe('defaultMigrationDir()', () => {
    it('uses migrations in the project directory for a resolved config without migration patterns', () => {
        expect(defaultMigrationDir({ config, resolvedBy: '@acme/cloud' }, '/project')).toBe(
            path.join('/project', 'migrations'),
        );
    });

    it("uses the directory of the config's first migrations pattern", () => {
        const withMigrations = {
            dbConnectionOptions: { type: 'postgres', migrations: ['/project/db/migrations/*.ts'] },
        } as unknown as VendureConfig;

        expect(defaultMigrationDir({ config: withMigrations, resolvedBy: '@acme/cloud' }, '/project')).toBe(
            path.normalize('/project/db/migrations'),
        );
    });
});
