import { InvalidArgumentError } from 'commander';

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
        description: 'A TanStack Start storefront with routing, internationalization, and checkout',
        frameworkName: 'TanStack Start',
        documentationUrl: 'https://tanstack.com/start/latest/docs/framework/react/overview',
        repository: 'vendurehq/tanstack-starter-vendure',
        ref: 'v1.0.0',
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
        description: 'A Next.js storefront with routing, internationalization, and checkout',
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

export function parseStorefrontId(value: string): StorefrontId {
    const normalizedValue = value.toLowerCase();
    const storefront = STOREFRONT_STARTERS.find(candidate => candidate.id === normalizedValue);
    if (!storefront) {
        throw new InvalidArgumentError(
            `Allowed choices are: ${STOREFRONT_STARTERS.map(candidate => candidate.id).join(', ')}.`,
        );
    }
    return storefront.id;
}

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
    return {
        ...packageJson,
        name: 'storefront',
        scripts: {
            ...(packageJson.scripts ?? {}),
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
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + '\n'
    );
}
