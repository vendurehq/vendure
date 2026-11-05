import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDependencyCheck } from './dependency-check';

// Mock fs-extra
vi.mock('fs-extra', () => ({
    default: {
        existsSync: vi.fn(),
        readJsonSync: vi.fn(),
        readFileSync: vi.fn(),
        readdirSync: vi.fn(() => []),
    },
}));

import fs from 'fs-extra';

const REMOVED_PACKAGES = ['@vendure/admin-ui', '@vendure/admin-ui-plugin', '@vendure/ui-devkit'];

/**
 * Reports every path as existing, except the package.json files of the packages removed
 * in v4, which a v4 project does not have installed.
 */
function existsExceptRemovedPackages(installed: string[] = []) {
    return (p: any) => {
        const pathStr = String(p);
        const removed = REMOVED_PACKAGES.find(pkg => pathStr.endsWith(`/${pkg}/package.json`));
        return !removed || installed.includes(removed);
    };
}

describe('dependency-check', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns fail when node_modules does not exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = await runDependencyCheck('/fake/node_modules');

        expect(result.status).toBe('fail');
        expect(result.message).toContain('node_modules not found');
    });

    it('returns pass when all @vendure/* packages are same version', async () => {
        vi.mocked(fs.existsSync).mockImplementation(existsExceptRemovedPackages());
        vi.mocked(fs.readJsonSync).mockReturnValue({ version: '3.6.3' });
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = await runDependencyCheck('/fake/node_modules');

        expect(result.status).toBe('pass');
        expect(result.details?.some(d => d.includes('All @vendure/* packages at 3.6.3'))).toBe(true);
    });

    it('returns warn when @vendure/* patch versions are mismatched', async () => {
        vi.mocked(fs.existsSync).mockImplementation(existsExceptRemovedPackages());
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        let callCount = 0;
        vi.mocked(fs.readJsonSync).mockImplementation(() => {
            callCount++;
            // Return different patch version for one package
            if (callCount === 3) {
                return { version: '3.6.2' };
            }
            return { version: '3.6.3' };
        });

        const result = await runDependencyCheck('/fake/node_modules');

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('Mismatched') && d.includes('patch'))).toBe(true);
    });

    it('returns fail when @vendure/* minor versions are mismatched', async () => {
        vi.mocked(fs.existsSync).mockImplementation(existsExceptRemovedPackages());
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        let callCount = 0;
        vi.mocked(fs.readJsonSync).mockImplementation(() => {
            callCount++;
            // Return different minor version for one package
            if (callCount === 3) {
                return { version: '3.7.0' };
            }
            return { version: '3.6.3' };
        });

        const result = await runDependencyCheck('/fake/node_modules');

        expect(result.status).toBe('fail');
        expect(result.details?.some(d => d.includes('Mismatched') && d.includes('minor/major'))).toBe(true);
    });

    it('detects duplicate singleton packages', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            // node_modules exists
            if (pathStr === '/fake/node_modules') return true;
            // installed @vendure packages exist
            if (pathStr.includes('@vendure')) return existsExceptRemovedPackages()(pathStr);
            // root graphql exists
            if (pathStr === '/fake/node_modules/graphql/package.json') return true;
            // nested graphql exists
            if (pathStr.includes('msw/node_modules/graphql/package.json')) return true;
            return false;
        });
        vi.mocked(fs.readdirSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr === '/fake/node_modules') return ['msw'] as any;
            return [];
        });
        vi.mocked(fs.readJsonSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr === '/fake/node_modules/graphql/package.json') {
                return { version: '16.11.0' };
            }
            if (pathStr.includes('msw/node_modules/graphql/package.json')) {
                return { version: '16.14.0' };
            }
            return { version: '3.6.3' };
        });
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = await runDependencyCheck('/fake/node_modules');

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('Multiple graphql versions'))).toBe(true);
    });

    it('returns pass with no duplicate singleton dependencies', async () => {
        vi.mocked(fs.existsSync).mockImplementation(existsExceptRemovedPackages());
        vi.mocked(fs.readJsonSync).mockReturnValue({ version: '3.6.3' });
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = await runDependencyCheck('/fake/node_modules');

        expect(result.details?.some(d => d.includes('No duplicate singleton dependencies'))).toBe(true);
    });

    it('returns pass with exact details when no removed packages are installed', async () => {
        vi.mocked(fs.existsSync).mockImplementation(existsExceptRemovedPackages());
        vi.mocked(fs.readJsonSync).mockReturnValue({ version: '4.0.0' });
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = await runDependencyCheck('/fake/node_modules');

        expect(result.status).toBe('pass');
        expect(result.details).toEqual([
            'All @vendure/* packages at 4.0.0',
            'No duplicate singleton dependencies',
        ]);
    });

    it('warns about each Angular admin UI package that was removed in v4', async () => {
        vi.mocked(fs.existsSync).mockImplementation(
            existsExceptRemovedPackages(['@vendure/admin-ui-plugin']),
        );
        vi.mocked(fs.readJsonSync).mockImplementation((p: any) =>
            String(p).includes('/@vendure/admin-ui-plugin/') ? { version: '3.8.1' } : { version: '4.0.0' },
        );
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = await runDependencyCheck('/fake/node_modules');

        expect(result.status).toBe('warn');
        expect(result.details).toEqual([
            'All @vendure/* packages at 4.0.0',
            'No duplicate singleton dependencies',
            '@vendure/admin-ui-plugin@3.8.1 is not supported in Vendure v4: ' +
                'replace AdminUiPlugin with DashboardPlugin from @vendure/dashboard',
        ]);
    });
});
