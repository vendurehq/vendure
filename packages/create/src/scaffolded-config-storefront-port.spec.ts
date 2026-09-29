import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PORT_SCAN_RANGE, STOREFRONT_PORT } from './constants';
import { getCiConfiguration } from './gather-user-responses';
import { getStorefrontStarter, renderStorefrontEnvironment } from './storefront-starters';

const { findAvailablePortMock } = vi.hoisted(() => ({ findAvailablePortMock: vi.fn() }));

// The scaffolder picks the storefront's dev port by probing with findAvailablePort. Pinning
// the probe makes the port the scaffold settles on deterministic, so these tests can assert
// that both halves of the generated project quote that same port.
vi.mock('./helpers', async importOriginal => {
    const actual = await importOriginal<typeof import('./helpers')>();
    return { ...actual, findAvailablePort: findAvailablePortMock };
});

// Deliberately not 3001, so a config that merely happens to name the default cannot pass.
const SCANNED_STOREFRONT_PORT = 4321;
const SERVER_PORT = 3000;
const PROJECT_ROOT = 'my-vendure-app';

describe('scaffolded vendure-config storefront port (#5245)', () => {
    beforeAll(async () => {
        const { getPackageManagerInfo, registerTemplateHelpers } = await import('./helpers');
        // create-vendure-app.ts registers these once before generating any source.
        registerTemplateHelpers(getPackageManagerInfo('npm'));
    });

    beforeEach(() => {
        findAvailablePortMock.mockReset();
        findAvailablePortMock.mockResolvedValue(SCANNED_STOREFRONT_PORT);
    });

    it('points the email URLs at the storefront the scaffold actually created', async () => {
        const { configSource } = await getCiConfiguration(PROJECT_ROOT, 'npm', SERVER_PORT, 'nextjs');

        // The issue reports a verification link on a port nothing listens on.
        expect(configSource).not.toContain('localhost:8080');
        expect(configSource).toContain(
            `verifyEmailAddressUrl: 'http://localhost:${SCANNED_STOREFRONT_PORT}/verify'`,
        );
        expect(configSource).toContain(
            `passwordResetUrl: 'http://localhost:${SCANNED_STOREFRONT_PORT}/password-reset'`,
        );
        expect(configSource).toContain(
            `changeEmailAddressUrl: 'http://localhost:${SCANNED_STOREFRONT_PORT}/verify-email-address-change'`,
        );
    });

    it('agrees with the origin written into the storefront own env file', async () => {
        const { configSource, storefrontPort } = await getCiConfiguration(
            PROJECT_ROOT,
            'npm',
            SERVER_PORT,
            'nextjs',
        );

        // create-vendure-app.ts builds this same context from the same storefrontPort and
        // writes the result to the storefront's env file, so this is the origin the generated
        // storefront will really serve on.
        const environment = renderStorefrontEnvironment(getStorefrontStarter('nextjs'), {
            projectName: PROJECT_ROOT,
            serverPort: SERVER_PORT,
            storefrontPort,
            revalidationSecret: 'test-secret',
        });
        const siteUrl = /NEXT_PUBLIC_SITE_URL=.(http:\/\/localhost:\d+)/.exec(environment)?.[1];
        expect(siteUrl).toBe(`http://localhost:${SCANNED_STOREFRONT_PORT}`);

        // The two halves of one generated project must not disagree about the port.
        for (const route of ['/verify', '/password-reset', '/verify-email-address-change']) {
            expect(configSource).toContain(`${siteUrl}${route}`);
        }
    });

    it('starts the scan above the server port when the server already took 3001', async () => {
        await getCiConfiguration(PROJECT_ROOT, 'npm', 3001, 'nextjs');

        expect(findAvailablePortMock).toHaveBeenCalledWith(3002, PORT_SCAN_RANGE);
    });

    it('scans from the storefront default when the server port is below it', async () => {
        await getCiConfiguration(PROJECT_ROOT, 'npm', SERVER_PORT, 'nextjs');

        expect(findAvailablePortMock).toHaveBeenCalledWith(STOREFRONT_PORT, PORT_SCAN_RANGE);
    });

    it('does not scan without a storefront, and says the port is only a placeholder', async () => {
        const { configSource, storefrontPort } = await getCiConfiguration(
            PROJECT_ROOT,
            'npm',
            SERVER_PORT,
            undefined,
        );

        expect(findAvailablePortMock).not.toHaveBeenCalled();
        expect(storefrontPort).toBe(STOREFRONT_PORT);
        // Nothing is listening on it, so the generated file has to say so.
        expect(configSource).toContain(`port ${STOREFRONT_PORT} is only a placeholder`);
        expect(configSource).toContain(`http://localhost:${STOREFRONT_PORT}/verify'`);
    });
});
