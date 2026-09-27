import { VendurePlugin } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file';

import { runConfigCheck } from './config-check';

vi.mock('../../../shared/shared-prompts', () => ({
    analyzeProject: vi.fn(async () => ({ project: {}, vendureTsConfig: undefined })),
}));

vi.mock('../../../shared/vendure-config-ref', () => ({
    VendureConfigRef: vi.fn(() => ({ getPathRelativeToProjectRoot: () => 'vendure-config.ts' })),
}));

vi.mock('../../../shared/load-vendure-config-file', () => ({
    loadVendureConfigFile: vi.fn(),
}));

// Use the workspace package as the "project" copy, so that the plugins below and the
// config check share one `@vendure/core`.
vi.mock('../../../shared/project-core', () => ({
    requireProjectCore: () => require('@vendure/core'),
}));

@VendurePlugin({ compatibility: '^1.0.0' })
class IncompatibleChildPlugin {}

@VendurePlugin({ plugins: [IncompatibleChildPlugin], compatibility: '>0.0.0' })
class ParentPlugin {}

describe('runConfigCheck()', () => {
    // #5430 — a composed plugin is loaded, so its compatibility range is checked too.
    it('checks the compatibility of composed plugins', async () => {
        vi.mocked(loadVendureConfigFile).mockResolvedValue({
            apiOptions: {},
            authOptions: {},
            dbConnectionOptions: { type: 'better-sqlite3' },
            plugins: [{ module: ParentPlugin }],
        } as any);

        const { check } = await runConfigCheck();

        expect(check.status).toBe('fail');
        expect(check.details).toContain('2 plugin(s) loaded');
        expect(check.details.join('\n')).toContain('Plugin "IncompatibleChildPlugin": incompatible');
    });
});
