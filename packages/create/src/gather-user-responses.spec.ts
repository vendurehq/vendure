import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { STOREFRONT_PORT } from './constants';
import { getCiConfiguration } from './gather-user-responses';
import { getPackageManagerInfo, registerTemplateHelpers } from './helpers';

const { findAvailablePortMock } = vi.hoisted(() => ({ findAvailablePortMock: vi.fn() }));

// vi.mock calls are hoisted above these imports, so gather-user-responses.ts
// (which imports findAvailablePort from './helpers') sees the mock below.
vi.mock('./helpers', async importOriginal => {
    const actual = await importOriginal<typeof import('./helpers')>();
    return {
        ...actual,
        findAvailablePort: findAvailablePortMock,
    };
});

describe('getCiConfiguration', () => {
    beforeAll(() => {
        // Normally registered once in create-vendure-app.ts before any config is generated.
        registerTemplateHelpers(getPackageManagerInfo('npm'));
    });

    afterEach(() => {
        // resetAllMocks (not clearAllMocks) so a mockResolvedValue set in one test
        // can't leak into the next if tests are reordered or a new one is added.
        vi.resetAllMocks();
    });

    it('templates the real scanned storefront port into the generated vendure-config when a storefront is selected', async () => {
        const mockedStorefrontPort = 4321;
        findAvailablePortMock.mockResolvedValue(mockedStorefrontPort);

        const root = path.join(os.tmpdir(), 'gather-user-responses-spec-with-storefront');
        const responses = await getCiConfiguration(root, 'npm', 3000, 'nextjs');

        expect(responses.storefrontPort).toBe(mockedStorefrontPort);
        expect(responses.configSource).toContain(`http://localhost:${mockedStorefrontPort}/verify`);
        expect(responses.configSource).toContain(`http://localhost:${mockedStorefrontPort}/password-reset`);
        expect(responses.configSource).toContain(
            `http://localhost:${mockedStorefrontPort}/verify-email-address-change`,
        );
        expect(responses.configSource).not.toContain('localhost:8080');
        expect(findAvailablePortMock).toHaveBeenCalledWith(3001, expect.any(Number));
    });

    it('falls back to the default placeholder port when no storefront is selected', async () => {
        const root = path.join(os.tmpdir(), 'gather-user-responses-spec-no-storefront');
        const responses = await getCiConfiguration(root, 'npm', 3000, undefined);

        expect(responses.storefrontPort).toBe(STOREFRONT_PORT);
        expect(responses.configSource).toContain(`http://localhost:${STOREFRONT_PORT}/verify`);
        expect(responses.configSource).not.toContain('localhost:8080');
        expect(findAvailablePortMock).not.toHaveBeenCalled();
    });
});
