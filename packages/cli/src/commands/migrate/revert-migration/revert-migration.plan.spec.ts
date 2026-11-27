import type { CommandContext } from '@vendure/common/lib/command';
import type { VendureConfig } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lastAppliedMigration, openMigrationProject } from '../migration-project.js';

import { plan } from './revert-migration.plan.js';

vi.mock('../migration-project.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../migration-project.js')>()),
    openMigrationProject: vi.fn(),
    lastAppliedMigration: vi.fn(() => Promise.resolve('AddReviews1700000000000')),
}));

const config = { dbConnectionOptions: { type: 'postgres', database: 'shop' } } as unknown as VendureConfig;
const ctx = { cwd: '/project', signal: new AbortController().signal } as CommandContext;

describe('migrate revert plan()', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('names the package whose config resolver provided the config', async () => {
        vi.mocked(openMigrationProject).mockResolvedValueOnce({
            config,
            resolvedBy: '@acme/cloud',
            projectDir: '/project',
        });

        expect(await plan({}, ctx)).toMatchObject({
            preview: {
                config: 'the config resolver of @acme/cloud',
                database: { type: 'postgres', database: 'shop' },
                lastAppliedMigration: 'AddReviews1700000000000',
            },
            requiredConsents: ['revertMigration'],
        });
        expect(lastAppliedMigration).toHaveBeenCalledWith(config);
    });
});
