import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runProjectCheck } from './project-check';

// Mock fs-extra
vi.mock('fs-extra', () => ({
    default: {
        existsSync: vi.fn(),
        readJsonSync: vi.fn(),
        readFileSync: vi.fn(),
    },
}));

// Mock monorepo-utils
vi.mock('../../../utilities/monorepo-utils', () => ({
    detectMonorepoStructure: vi.fn(() => ({ isMonorepo: false })),
    findPackageJsonWithDependency: vi.fn(() => null),
}));

import fs from 'fs-extra';
import { detectMonorepoStructure, findPackageJsonWithDependency } from '../../../utilities/monorepo-utils';

describe('project-check', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns fail when no package.json exists', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = await runProjectCheck();

        expect(result.status).toBe('fail');
        expect(result.message).toContain('No package.json');
    });

    it('returns fail when package.json cannot be parsed', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readJsonSync).mockImplementation(() => {
            throw new Error('Invalid JSON');
        });

        const result = await runProjectCheck();

        expect(result.status).toBe('fail');
        expect(result.message).toContain('Failed to parse');
    });

    it('returns fail when no @vendure/* dependencies found', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readJsonSync).mockReturnValue({
            dependencies: { express: '4.0.0' },
            devDependencies: {},
        });
        vi.mocked(findPackageJsonWithDependency).mockReturnValue(null);

        const result = await runProjectCheck();

        expect(result.status).toBe('fail');
        expect(result.message).toContain('No @vendure/* dependencies');
    });

    it('returns pass when @vendure/* dependencies found', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readJsonSync).mockReturnValue({
            dependencies: { '@vendure/core': '3.6.3' },
            devDependencies: {},
        });

        // Use --config to skip config file discovery
        const result = await runProjectCheck('vendure-config.ts');

        expect(result.status).toBe('pass');
    });

    it('returns fail when --config points to nonexistent file', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr.endsWith('package.json')) return true;
            if (pathStr.endsWith('nonexistent.ts')) return false;
            return false;
        });
        vi.mocked(fs.readJsonSync).mockReturnValue({
            dependencies: { '@vendure/core': '3.6.3' },
            devDependencies: {},
        });

        const result = await runProjectCheck('nonexistent.ts');

        expect(result.status).toBe('fail');
        expect(result.message).toContain('Specified config file not found');
    });

    it('reports package manager from lockfile', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr.endsWith('package.json')) return true;
            if (pathStr.endsWith('yarn.lock')) return true;
            return false;
        });
        vi.mocked(fs.readJsonSync).mockReturnValue({
            dependencies: { '@vendure/core': '3.6.3' },
            devDependencies: {},
        });

        const result = await runProjectCheck();

        expect(result.packageManager).toBe('yarn');
        expect(result.details).toContain('Package manager: yarn');
    });

    it('warns when multiple lockfiles found (different managers)', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr.endsWith('package.json')) return true;
            if (pathStr.endsWith('yarn.lock')) return true;
            if (pathStr.endsWith('package-lock.json')) return true;
            return false;
        });
        vi.mocked(fs.readJsonSync).mockReturnValue({
            dependencies: { '@vendure/core': '3.6.3' },
            devDependencies: {},
        });

        const result = await runProjectCheck();

        expect(result.details?.some(d => d.includes('multiple lockfiles'))).toBe(true);
    });

    it('does not warn when both bun.lockb and bun.lock exist', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr.endsWith('package.json')) return true;
            if (pathStr.endsWith('bun.lockb')) return true;
            if (pathStr.endsWith('bun.lock')) return true;
            return false;
        });
        vi.mocked(fs.readJsonSync).mockReturnValue({
            dependencies: { '@vendure/core': '3.6.3' },
            devDependencies: {},
        });

        const result = await runProjectCheck();

        expect(result.packageManager).toBe('bun');
        expect(result.details?.some(d => d.includes('multiple lockfiles'))).toBe(false);
    });

    it('detects monorepo structure', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr.endsWith('package.json')) return true;
            return false;
        });
        vi.mocked(fs.readJsonSync).mockReturnValue({
            dependencies: {},
            devDependencies: {},
        });
        vi.mocked(detectMonorepoStructure).mockReturnValue({
            isMonorepo: true,
            root: '/monorepo',
            packageDir: 'packages',
        });
        vi.mocked(findPackageJsonWithDependency).mockReturnValue('/monorepo/packages/app/package.json');

        const result = await runProjectCheck();

        expect(result.status).toBe('pass');
        expect(result.details?.some(d => d.includes('Monorepo detected'))).toBe(true);
    });
});
