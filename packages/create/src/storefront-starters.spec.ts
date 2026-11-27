import fs from 'fs-extra';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { describe, expect, it } from 'vitest';

import {
    configureStorefrontPackageJson,
    extractStorefrontArchive,
    getStorefrontStarter,
    renderStorefrontEnvironment,
    STOREFRONT_STARTERS,
} from './storefront-starters.js';

const setupContext = {
    projectName: 'my-shop',
    serverPort: 3000,
    storefrontPort: 3001,
    revalidationSecret: 'secret',
};

describe('storefront starters', () => {
    it('uses unique ids and resolves every registered starter', () => {
        const ids = STOREFRONT_STARTERS.map(storefront => storefront.id);

        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
            expect(getStorefrontStarter(id)).toMatchObject({ id });
        }
    });

    it('configures the TanStack Start scripts for the generated workspace', () => {
        const storefront = getStorefrontStarter('tanstack');
        const packageJson = configureStorefrontPackageJson(
            { name: 'tanstack-starter-vendure', scripts: { build: 'vite build' } },
            storefront,
            setupContext,
        );

        expect(packageJson.name).toBe('storefront');
        expect(packageJson.scripts).toEqual({
            build: 'vite build',
            dev: 'vite dev --port 3001',
            start: 'node .output/server/index.mjs',
        });
    });

    it('renders the environment contract expected by TanStack Start', () => {
        const storefront = getStorefrontStarter('tanstack');

        expect(storefront.envFile).toBe('.env');
        expect(renderStorefrontEnvironment(storefront, setupContext)).toBe(
            [
                "VENDURE_SHOP_API_URL='http://localhost:3000/shop-api'",
                "VENDURE_CHANNEL_TOKEN='__default_channel__'",
                "SITE_URL='http://localhost:3001'",
                "SITE_NAME='my-shop'",
                "REVALIDATION_SECRET='secret'",
                '',
            ].join('\n'),
        );
    });

    it('keeps the Next.js environment and scripts starter-specific', () => {
        const storefront = getStorefrontStarter('nextjs');
        const packageJson = configureStorefrontPackageJson(
            { scripts: { start: 'next start' } },
            storefront,
            setupContext,
        );
        const environment = renderStorefrontEnvironment(storefront, setupContext);

        expect(storefront.envFile).toBe('.env.local');
        expect(packageJson.scripts).toMatchObject({
            dev: 'next dev --port 3001',
            start: 'next start',
        });
        expect(environment).toContain("NEXT_PUBLIC_SITE_URL='http://localhost:3001'");
        expect(environment).not.toContain('\nSITE_URL=');
    });

    it.each(['tanstack', 'nextjs'] as const)(
        'preserves comment and quote characters in the %s environment file',
        storefrontId => {
            const storefront = getStorefrontStarter(storefrontId);
            const environment = renderStorefrontEnvironment(storefront, {
                ...setupContext,
                projectName: 'shop#"demo"',
            });
            const siteNameKey = storefrontId === 'nextjs' ? 'NEXT_PUBLIC_SITE_NAME' : 'SITE_NAME';

            expect(environment).toContain(`${siteNameKey}='shop#"demo"'`);
        },
    );

    it('uses backticks when an environment value contains both other quote characters', () => {
        const environment = renderStorefrontEnvironment(getStorefrontStarter('tanstack'), {
            ...setupContext,
            projectName: `shop'"demo`,
        });

        expect(environment).toContain('SITE_NAME=`shop\'"demo`');
    });

    it('identifies an environment key whose value cannot be quoted', () => {
        expect(() =>
            renderStorefrontEnvironment(getStorefrontStarter('nextjs'), {
                ...setupContext,
                projectName: `shop'"\`demo`,
            }),
        ).toThrow(
            'Cannot write NEXT_PUBLIC_SITE_NAME to the storefront env file: the value contains a single quote, ' +
                'a double quote and a backtick, leaving no character to quote it with. ' +
                'Choose a project name without one of those characters.',
        );
    });
});

describe('configureStorefrontPackageJson()', () => {
    it('removes the husky prepare script, whose hooks create leaves out', () => {
        const storefront = getStorefrontStarter('tanstack');
        const configured = configureStorefrontPackageJson(
            { scripts: { prepare: 'husky', lint: 'biome lint' } },
            storefront,
            setupContext,
        );
        expect(configured.scripts).not.toHaveProperty('prepare');
        expect(configured.scripts).toMatchObject({ lint: 'biome lint' });
    });

    it('keeps any other prepare script', () => {
        const configured = configureStorefrontPackageJson(
            { scripts: { prepare: 'node scripts/setup.mjs' } },
            getStorefrontStarter('nextjs'),
            setupContext,
        );
        expect(configured.scripts).toMatchObject({ prepare: 'node scripts/setup.mjs' });
    });
});

describe('extractStorefrontArchive()', () => {
    it('leaves out the files that work only at the repository root, and keeps the rest', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'vendure-create-storefront-'));
        try {
            const repo = path.join(dir, 'vendurehq-starter-abc123');
            const files = [
                'package.json',
                'package-lock.json',
                '.npmrc',
                '.mcp.json',
                '.github/workflows/ci.yml',
                '.github/PULL_REQUEST_TEMPLATE.md',
                '.husky/commit-msg',
                '.vscode/settings.json',
                'AGENTS.md',
                'LICENSE',
                'src/app.ts',
                // Only the root files are left out.
                'docs/.github/notes.md',
                'scripts/package-lock.json',
            ];
            for (const file of files) {
                fs.outputFileSync(path.join(repo, file), file);
            }
            const archive = path.join(dir, 'starter.tar.gz');
            await tar.create({ file: archive, gzip: true, cwd: dir }, [path.basename(repo)]);
            const target = path.join(dir, 'apps/storefront');

            await extractStorefrontArchive(archive, target);

            const extracted = fs
                .readdirSync(target, { recursive: true, withFileTypes: true })
                .filter(entry => entry.isFile())
                .map(entry =>
                    path.relative(target, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
                )
                .sort();
            expect(extracted).toEqual(
                [
                    '.vscode/settings.json',
                    'AGENTS.md',
                    'LICENSE',
                    'docs/.github/notes.md',
                    'package.json',
                    'scripts/package-lock.json',
                    'src/app.ts',
                ].sort(),
            );
        } finally {
            fs.removeSync(dir);
        }
    });
});
