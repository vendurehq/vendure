import { parseCreateRecord } from '@vendure/common/lib/create-record';
import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { describe, expect, it } from 'vitest';

import { CLOUD_PACKAGE_RANGE, TYPEORM_VERSION } from './constants.js';
import { getPackageManagerInfo } from './package-manager.js';
import {
    buildCreateRecord,
    getNextCommands,
    getServerPackageJson,
    getWorkspaceRootPackageJson,
    renderReadme,
    toPackageName,
} from './project-files.js';
import { STOREFRONT_STARTERS } from './storefront-starters.js';
import { CreateOptions } from './types.js';

const options: CreateOptions = {
    projectDir: '/work/my-shop',
    name: 'my-shop',
    packageManager: 'pnpm',
    storefront: 'nextjs',
    preset: { name: 'single-country', options: { country: 'NZ', currency: 'NZD' } },
    scenario: null,
    features: [],
    agents: ['claude', 'codex'],
    install: true,
    git: true,
};

const serverInput = {
    name: 'my-shop',
    vendureVersion: '4.0.0',
    packageManager: 'npm' as const,
    features: [],
    scenario: null,
    isRoot: true,
};

describe('getServerPackageJson()', () => {
    it('writes a Cloud Config app: dev, build and typecheck, and @vendure/cloud as a CLI plugin', () => {
        const pkg = getServerPackageJson(serverInput) as any;
        expect(pkg.scripts).toEqual({ dev: 'vendure dev', build: 'tsc', typecheck: 'tsc --noEmit' });
        expect(pkg.vendure).toEqual({ cli: { plugins: ['@vendure/cloud'] } });
        expect(pkg.dependencies).toMatchObject({
            '@vendure/cloud': CLOUD_PACKAGE_RANGE,
            '@vendure/core': '4.0.0',
            '@vendure/mcp-plugin': '4.0.0',
        });
        expect(pkg.devDependencies).toMatchObject({ '@vendure/cli': '4.0.0', '@vendure/dashboard': '4.0.0' });
        // No database driver for SQLite, MySQL or a self-hosted start script.
        expect(JSON.stringify(pkg)).not.toMatch(/better-sqlite3|mysql2|dotenv|index-worker|start:/);
    });

    it('pins the @vendure/cloud range', () => {
        expect(CLOUD_PACKAGE_RANGE).toBe('>=0.9.0-0 <0.10.0');
    });

    it('accepts the 0.9.0 prereleases and the 0.9.x releases of @vendure/cloud, and nothing else', () => {
        const accepts = (version: string) => semver.satisfies(version, CLOUD_PACKAGE_RANGE);
        expect(accepts('0.9.0-dev.20261123092810.g887b3f3')).toBe(true);
        expect(accepts('0.9.0')).toBe(true);
        expect(accepts('0.9.3')).toBe(true);
        // A prerelease of a later patch does not match: semver takes prereleases only on 0.9.0.
        expect(accepts('0.9.1-dev.1')).toBe(false);
        expect(accepts('0.8.0')).toBe(false);
        expect(accepts('0.10.0')).toBe(false);
        expect(accepts('0.10.0-dev.1')).toBe(false);
        // npm picks the highest match, so a release wins over a prerelease.
        expect(
            semver.maxSatisfying(
                ['0.8.0', '0.9.0-dev.20261123092810.g887b3f3', '0.9.0'],
                CLOUD_PACKAGE_RANGE,
            ),
        ).toBe('0.9.0');
    });

    it('declares typeorm for pnpm only, with the range @vendure/core uses', () => {
        const corePackageJson = JSON.parse(
            fs.readFileSync(path.join(import.meta.dirname, '../../core/package.json'), 'utf-8'),
        );
        expect(TYPEORM_VERSION).toBe(corePackageJson.dependencies.typeorm);
        expect(
            (getServerPackageJson({ ...serverInput, packageManager: 'pnpm' }) as any).dependencies.typeorm,
        ).toBe(TYPEORM_VERSION);
        expect((getServerPackageJson(serverInput) as any).dependencies.typeorm).toBeUndefined();
    });

    it('adds the scenario package and the feature set dependencies', () => {
        const pkg = getServerPackageJson({
            ...serverInput,
            scenario: { name: 'demo', package: '@example/scenario-demo', version: '1.2.3' },
            features: [{ name: 'b2b', description: '', dependencies: { '@example/b2b': '2.0.0' } }],
        }) as any;
        expect(pkg.devDependencies['@example/scenario-demo']).toBe('1.2.3');
        expect(pkg.dependencies['@example/b2b']).toBe('2.0.0');
    });

    it('carries the build-script allowlist only at the root', () => {
        expect(getServerPackageJson(serverInput)).toHaveProperty('allowScripts');
        expect(getServerPackageJson({ ...serverInput, isRoot: false })).not.toHaveProperty('allowScripts');
    });
});

describe('getWorkspaceRootPackageJson()', () => {
    it('runs the server and the storefront workspaces with the chosen manager', () => {
        const pkg = getWorkspaceRootPackageJson('my-shop', getPackageManagerInfo('pnpm'), '4.0.0') as any;
        expect(pkg.scripts['dev:server']).toBe('pnpm --filter server dev');
        expect(pkg.workspaces).toBeUndefined();
        expect(pkg.devDependencies['@vendure/cli']).toBe('4.0.0');
        expect(
            (getWorkspaceRootPackageJson('my-shop', getPackageManagerInfo('npm'), '4.0.0') as any).workspaces,
        ).toEqual(['apps/*']);
    });
});

describe('the Cloud Config template', () => {
    const source = fs.readFileSync(
        path.join(import.meta.dirname, '../templates/vendure-config.ts.template'),
        'utf-8',
    );

    it('defines a Cloud Config with a store extension that declares migrations', () => {
        expect(source).toContain('export const config = defineCloudConfig(');
        expect(source).toMatch(
            /defineVendureExtension\(\{\s*id: 'store',[\s\S]*migrations: \['\.\/migrations\/\*'\]/,
        );
    });

    it('declares the MCP plugin, with its production settings from the environment', () => {
        expect(source).toContain("import { McpPlugin } from '@vendure/mcp-plugin';");
        expect(source).toContain("shopAccess: 'anonymous'");
        // The secret: the env var, then the development fallback, and nothing in production.
        expect(source).toMatch(/tokenSecret:\s*process\.env\.MCP_TOKEN_SECRET \?\?/);
        expect(source).toMatch(/process\.env\.NODE_ENV === 'production' \? '' : randomBytes\(32\)/);
        expect(source).toMatch(/issuer: process\.env\.MCP_ISSUER/);
    });

    it('sets nothing the Cloud runtime owns', () => {
        expect(source).not.toMatch(/dbConnectionOptions|superadminCredentials|port:|logger:/);
    });
});

describe('renderReadme()', () => {
    const template = fs.readFileSync(path.join(import.meta.dirname, '../templates/readme.hbs'), 'utf-8');
    const pmInfo = getPackageManagerInfo('pnpm');

    it('renders Markdown with its headings, fence and list on their own lines', () => {
        const readme = renderReadme(template, { name: 'my-shop', pmInfo, storefront: undefined });
        const lines = readme.split('\n');
        expect(lines[0]).toBe('# my-shop');
        for (const heading of ['## Develop', '## Project structure', '## Scripts', '## Deploy']) {
            expect(lines).toContain(heading);
        }
        expect(lines).toContain('```bash');
        expect(lines).toContain('pnpm run dev');
        expect(lines).toContain('- `src/vendure-config.ts`: the Vendure configuration, a Cloud Config.');
        expect(readme).not.toContain('{{');
    });

    it('names the server workspace and the storefront when there is one', () => {
        const storefront = STOREFRONT_STARTERS.find(s => s.id === 'nextjs');
        const readme = renderReadme(template, { name: 'my-shop', pmInfo, storefront });
        expect(readme.split('\n')).toContain(
            '- `apps/server/src/vendure-config.ts`: the Vendure configuration, a Cloud Config.',
        );
        expect(readme).toContain('- Storefront: http://localhost:3001');
    });
});

describe('buildCreateRecord()', () => {
    it('writes a record that parseCreateRecord accepts unchanged', () => {
        const record = buildCreateRecord(options, '4.0.0', { agents: ['claude', 'codex'] });
        expect(parseCreateRecord(JSON.parse(JSON.stringify(record)))).toEqual({ result: 'ok', record });
        expect(record).toMatchObject({
            version: 1,
            createdWith: '4.0.0',
            storefront: 'nextjs',
            agents: ['claude', 'codex'],
        });
    });
});

describe('getNextCommands()', () => {
    it('names the install only when create skipped it, with the chosen manager', () => {
        expect(getNextCommands(options, 'my-shop')).toEqual(['cd my-shop', 'pnpm run dev']);
        expect(getNextCommands({ ...options, install: false }, 'my shop')).toEqual([
            "cd 'my shop'",
            'pnpm install',
            'pnpm run dev',
        ]);
    });
});

describe('toPackageName()', () => {
    it('makes a valid npm name from the directory name', () => {
        expect(toPackageName('My Shop')).toBe('my-shop');
        expect(toPackageName('.hidden')).toBe('hidden');
        expect(toPackageName('***')).toBe('vendure-app');
    });

    it('collapses runs of other characters and trims the ends as the npm rules need', () => {
        expect(toPackageName('a--b')).toBe('a--b');
        expect(toPackageName('a  &  b')).toBe('a-b');
        expect(toPackageName('shop***')).toBe('shop');
        expect(toPackageName('shop-')).toBe('shop');
        expect(toPackageName('*.-_shop')).toBe('shop');
        expect(toPackageName('Café Shop')).toBe('caf-shop');
        expect(toPackageName('~my.shop_1')).toBe('~my.shop_1');
    });

    it('takes linear time on a long input of the characters a backtracking pattern trips on', () => {
        // A run of dashes followed by an allowed character: `/-+$/` retries from every dash.
        const adversarial = 'a' + '-'.repeat(50_000) + 'b';
        const start = performance.now();
        expect(toPackageName(adversarial)).toBe(adversarial);
        expect(toPackageName('-'.repeat(50_000))).toBe('vendure-app');
        expect(performance.now() - start).toBeLessThan(500);
    });
});
