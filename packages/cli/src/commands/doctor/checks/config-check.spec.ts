import { VendurePlugin } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file.js';

import { isCompatibleWithCore, runConfigCheck } from './config-check.js';

vi.mock('../../../shared/shared-prompts.js', () => ({
    analyzeProject: vi.fn(async () => ({ project: {}, vendureTsConfig: undefined })),
}));

vi.mock('../../../shared/vendure-config-ref.js', () => ({
    // A `function` (not an arrow function) because the code under test calls it with `new`.
    VendureConfigRef: vi.fn(function () {
        return { getPathRelativeToProjectRoot: () => 'vendure-config.ts' };
    }),
}));

vi.mock('../../../shared/load-vendure-config-file.js', () => ({
    loadVendureConfigFile: vi.fn(),
}));

// Use the workspace package as the "project" copy, so that the plugins below and the
// config check share one `@vendure/core`.
vi.mock('../../../shared/project-core.js', () => ({
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
        expect(check.details?.join('\n')).toContain('Plugin "IncompatibleChildPlugin": incompatible');
    });
});

describe('isCompatibleWithCore()', () => {
    type Core = Parameters<typeof isCompatibleWithCore>[0];

    it("uses the project core's own check, which accepts a prerelease of a covered release", () => {
        const isCompatible = vi.fn(() => true);
        const core = { VENDURE_VERSION: '4.0.0-major-202611260711', isCompatible } as unknown as Core;

        expect(isCompatibleWithCore(core, '^4.0.0')).toBe(true);
        expect(isCompatible).toHaveBeenCalledWith('4.0.0-major-202611260711', '^4.0.0');
    });

    it('checks the range itself for a core that has no isCompatible', () => {
        const core = { VENDURE_VERSION: '3.5.0' } as unknown as Core;

        expect(isCompatibleWithCore(core, '^3.0.0')).toBe(true);
        expect(isCompatibleWithCore(core, '^4.0.0')).toBe(false);
    });
});
