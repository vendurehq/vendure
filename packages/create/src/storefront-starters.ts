import fs from 'fs-extra';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';

export interface StorefrontSetupContext {
    projectName: string;
    serverPort: number;
    storefrontPort: number;
    revalidationSecret: string;
}

export interface StorefrontStarter {
    id: string;
    name: string;
    description: string;
    frameworkName: string;
    documentationUrl: string;
    repository: string;
    ref: string;
    envFile: string;
    packageScripts: (context: StorefrontSetupContext) => Record<string, string>;
    environment: (context: StorefrontSetupContext) => Record<string, string>;
}

interface StorefrontPackageJson extends Record<string, unknown> {
    scripts?: Record<string, string>;
}

export const STOREFRONT_STARTERS = [
    {
        id: 'tanstack',
        name: 'TanStack Start',
        description: 'Vite-powered routing with TanStack Router and Paraglide internationalization',
        frameworkName: 'TanStack Start',
        documentationUrl: 'https://tanstack.com/start/latest/docs/framework/react/overview',
        repository: 'vendurehq/tanstack-starter-vendure',
        ref: 'main',
        envFile: '.env',
        packageScripts: ({ storefrontPort }) => ({
            dev: `vite dev --port ${storefrontPort}`,
            start: 'node .output/server/index.mjs',
        }),
        environment: ({ projectName, serverPort, storefrontPort, revalidationSecret }) => ({
            VENDURE_SHOP_API_URL: `http://localhost:${serverPort}/shop-api`,
            VENDURE_CHANNEL_TOKEN: '__default_channel__',
            SITE_URL: `http://localhost:${storefrontPort}`,
            SITE_NAME: projectName,
            REVALIDATION_SECRET: revalidationSecret,
        }),
    },
    {
        id: 'nextjs',
        name: 'Next.js',
        description: 'App Router storefront with next-intl internationalization',
        frameworkName: 'Next.js',
        documentationUrl: 'https://nextjs.org/docs',
        repository: 'vendurehq/nextjs-starter-vendure',
        ref: 'main',
        envFile: '.env.local',
        packageScripts: ({ storefrontPort }) => ({
            dev: `next dev --port ${storefrontPort}`,
        }),
        environment: ({ projectName, serverPort, storefrontPort, revalidationSecret }) => ({
            VENDURE_SHOP_API_URL: `http://localhost:${serverPort}/shop-api`,
            VENDURE_CHANNEL_TOKEN: '__default_channel__',
            NEXT_PUBLIC_SITE_URL: `http://localhost:${storefrontPort}`,
            NEXT_PUBLIC_SITE_NAME: projectName,
            REVALIDATION_SECRET: revalidationSecret,
        }),
    },
] as const satisfies readonly StorefrontStarter[];

export type StorefrontId = (typeof STOREFRONT_STARTERS)[number]['id'];

export function getStorefrontStarter(id: StorefrontId): StorefrontStarter {
    const storefront = STOREFRONT_STARTERS.find(candidate => candidate.id === id);
    if (!storefront) {
        throw new Error(`Unknown storefront starter: ${id as string}`);
    }
    return storefront;
}

export function configureStorefrontPackageJson(
    packageJson: StorefrontPackageJson,
    storefront: StorefrontStarter,
    context: StorefrontSetupContext,
): StorefrontPackageJson {
    // These entries intentionally override the downloaded package.json. Starter repositories must
    // keep required flags out of their dev/start scripts, or mirror those flags here.
    // `husky` in `prepare` installs the hooks of `.husky`, which create leaves out.
    const { prepare, ...scripts } = packageJson.scripts ?? {};
    return {
        ...packageJson,
        name: 'storefront',
        scripts: {
            ...(prepare === undefined || prepare.trim() === 'husky' ? scripts : { ...scripts, prepare }),
            ...storefront.packageScripts(context),
        },
    };
}

export function renderStorefrontEnvironment(
    storefront: StorefrontStarter,
    context: StorefrontSetupContext,
): string {
    return (
        Object.entries(storefront.environment(context))
            .map(([key, value]) => `${key}=${quoteEnvironmentValue(key, value)}`)
            .join('\n') + '\n'
    );
}

function quoteEnvironmentValue(key: string, value: string): string {
    const delimiter = [`'`, `"`, '`'].find(candidate => !value.includes(candidate));
    if (!delimiter) {
        throw new Error(
            `Cannot write ${key} to the storefront env file: the value contains a single quote, ` +
                'a double quote and a backtick, leaving no character to quote it with. ' +
                'Choose a project name without one of those characters.',
        );
    }
    return `${delimiter}${value}${delimiter}`;
}

/**
 * Downloads a storefront starter from GitHub and extracts it to the target directory.
 * Uses the starter's main branch intentionally, so improvements and fixes are available to newly
 * scaffolded projects without requiring a matching @vendure/create release.
 */
export async function downloadAndExtractStorefront(
    targetDir: string,
    storefront: StorefrontStarter,
): Promise<void> {
    const tarballUrl = `https://api.github.com/repos/${storefront.repository}/tarball/${storefront.ref}`;
    const tempTarPath = path.join(targetDir, '..', 'storefront-temp.tar.gz');
    try {
        // A token (e.g. in CI) raises the rate limit.
        const response = await fetch(tarballUrl, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'vendure-create',
                ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to download storefront: ${response.status} ${response.statusText}`);
        }
        const nodeReadable = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
        await pipeline(nodeReadable, createWriteStream(tempTarPath));
        await extractStorefrontArchive(tempTarPath, targetDir);
    } finally {
        await fs.remove(tempTarPath);
    }
}

/**
 * Files at the root of a starter repository that work only at the root of a repository, so
 * create leaves them out of `apps/storefront`. The starter's `AGENTS.md` stays, and the root
 * `AGENTS.md` points to it. `.vscode` stays too: VS Code reads it when the storefront folder is
 * opened on its own.
 */
export const STOREFRONT_ROOT_ONLY_FILES: ReadonlySet<string> = new Set([
    // The workspace install writes the one lockfile, at the root.
    'package-lock.json',
    // npm reads only the root `.npmrc` of a workspace, so this one has no effect.
    '.npmrc',
    // GitHub reads workflows and templates only at the repository root.
    '.github',
    // Claude Code reads one `.mcp.json`, which create writes at the root.
    '.mcp.json',
    // husky installs its hooks only where `.git` is, so they never run from `apps/storefront`.
    '.husky',
]);

/** Extracts a starter archive into `targetDir`, without its top-level directory or root-only files. */
export async function extractStorefrontArchive(file: string, targetDir: string): Promise<void> {
    await fs.ensureDir(targetDir);
    await tar.extract({
        file,
        cwd: targetDir,
        strip: 1,
        filter: entryPath => !isRootOnlyFile(entryPath),
    });
}

/** The filter sees the path before `strip` removes the archive's top-level directory. */
function isRootOnlyFile(entryPath: string): boolean {
    const name = entryPath.split('/')[1];
    return name !== undefined && STOREFRONT_ROOT_ONLY_FILES.has(name);
}
