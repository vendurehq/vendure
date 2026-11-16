import fs from 'fs-extra';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findPackageJsonWithDependency, findWorkspacePackageJsonsWithDependency } from './monorepo-utils';

describe('workspace package discovery', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(tmpdir(), 'vendure-workspaces-'));
    });
    afterEach(() => fs.removeSync(dir));

    function writePackage(relativeDir: string, contents: object) {
        fs.outputJsonSync(path.join(dir, relativeDir, 'package.json'), contents);
    }

    it.each([
        { form: 'array', workspaces: ['server'], member: 'server' },
        { form: 'object', workspaces: { packages: ['server'] }, member: 'server' },
        { form: 'glob', workspaces: ['services/*'], member: 'services/server' },
    ])('reads the $form workspace form', ({ workspaces, member }) => {
        writePackage('', { workspaces });
        writePackage(member, { dependencies: { '@vendure/core': '3.6.0' } });
        expect(findWorkspacePackageJsonsWithDependency(dir, '@vendure/core')).toEqual([
            path.join(dir, member, 'package.json'),
        ]);
        expect(findPackageJsonWithDependency(dir, '@vendure/core')).toBe(
            path.join(dir, member, 'package.json'),
        );
    });

    it('finds directory symlinks in wildcards and skips broken links and file links', () => {
        writePackage('', { workspaces: ['projects/*'] });
        writePackage('server', { dependencies: { '@vendure/core': '3.6.0' } });
        fs.ensureDirSync(path.join(dir, 'projects'));
        fs.symlinkSync(path.join(dir, 'server'), path.join(dir, 'projects/server'), 'junction');
        fs.symlinkSync(path.join(dir, 'missing'), path.join(dir, 'projects/broken'), 'junction');
        fs.symlinkSync(path.join(dir, 'package.json'), path.join(dir, 'projects/file'));
        expect(findWorkspacePackageJsonsWithDependency(dir, '@vendure/core')).toEqual([
            path.join(dir, 'projects/server/package.json'),
        ]);
        expect(findPackageJsonWithDependency(dir, '@vendure/core')).toBe(
            path.join(dir, 'projects/server/package.json'),
        );
    });

    it('returns all candidates once when patterns overlap', () => {
        writePackage('', { workspaces: ['services/*', 'services/one'] });
        writePackage('services/one', { dependencies: { '@vendure/core': '3.6.0' } });
        writePackage('services/two', { devDependencies: { '@vendure/core': '3.6.0' } });
        writePackage('services/frontend', { dependencies: { react: '19' } });
        expect(findWorkspacePackageJsonsWithDependency(dir, '@vendure/core')).toEqual([
            path.join(dir, 'services/one/package.json'),
            path.join(dir, 'services/two/package.json'),
        ]);
    });

    it('returns no candidates for missing members or members without the dependency', () => {
        writePackage('', { workspaces: { packages: ['missing/*', 'frontend', 'invalid'] } });
        writePackage('frontend', { dependencies: { react: '19' } });
        fs.outputFileSync(path.join(dir, 'invalid/package.json'), '{');
        expect(findWorkspacePackageJsonsWithDependency(dir, '@vendure/core')).toEqual([]);
        expect(findPackageJsonWithDependency(dir, '@vendure/core')).toBeNull();
    });

    it('keeps root priority and conventional directory fallback', () => {
        writePackage('', { workspaces: ['server'] });
        writePackage('apps/legacy', { dependencies: { '@vendure/core': '3.6.0' } });
        expect(findPackageJsonWithDependency(dir, '@vendure/core')).toBe(
            path.join(dir, 'apps/legacy/package.json'),
        );
        writePackage('server', { dependencies: { '@vendure/core': '3.6.0' } });
        expect(findPackageJsonWithDependency(dir, '@vendure/core')).toBe(
            path.join(dir, 'server/package.json'),
        );
        writePackage('', { dependencies: { '@vendure/core': '3.6.0' }, workspaces: ['server'] });
        expect(findPackageJsonWithDependency(dir, '@vendure/core')).toBe(path.join(dir, 'package.json'));
    });
});
