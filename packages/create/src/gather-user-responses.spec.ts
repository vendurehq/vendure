import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PORT_SCAN_RANGE, STOREFRONT_PORT } from './constants';
import { getCiConfiguration, getQuickStartConfiguration } from './gather-user-responses';
import { getPackageManagerInfo, registerTemplateHelpers } from './helpers';

const DOCKER_FALLBACK_PROMPT = 'We could not automatically start Docker. How should we proceed?';

const { findAvailablePortMock, isDockerAvailableMock, selectMock, cancelMock, CANCELLED } = vi.hoisted(
    () => ({
        findAvailablePortMock: vi.fn(),
        isDockerAvailableMock: vi.fn(),
        selectMock: vi.fn(),
        cancelMock: vi.fn(),
        CANCELLED: Symbol('cancelled'),
    }),
);

// The real cancel value is a module-private Symbol in @clack/core, and producing it by
// driving a real prompt fails outside a TTY, so isCancel is stubbed to recognise a
// stand-in. Everything downstream of it stays real: checkCancel, its cancel() call and
// the process.exit it makes.
vi.mock('@clack/prompts', async importOriginal => ({
    ...(await importOriginal<typeof import('@clack/prompts')>()),
    select: selectMock,
    cancel: cancelMock,
    isCancel: (value: unknown) => value === CANCELLED,
}));

// vi.mock calls are hoisted above these imports, so gather-user-responses.ts
// (which imports findAvailablePort from './helpers') sees the mock below.
vi.mock('./helpers', async importOriginal => {
    const actual = await importOriginal<typeof import('./helpers')>();
    return {
        ...actual,
        findAvailablePort: findAvailablePortMock,
        isDockerAvailable: isDockerAvailableMock,
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

        const responses = await getCiConfiguration('my-vendure-app', 'npm', 3000, 'nextjs');

        expect(responses.storefrontPort).toBe(mockedStorefrontPort);
        expect(responses.configSource).toContain(`http://localhost:${mockedStorefrontPort}/verify`);
        expect(responses.configSource).toContain(`http://localhost:${mockedStorefrontPort}/reset-password`);
        expect(responses.configSource).toContain(
            `http://localhost:${mockedStorefrontPort}/account/verify-email`,
        );
        expect(findAvailablePortMock).toHaveBeenCalledWith(STOREFRONT_PORT, PORT_SCAN_RANGE);
    });

    it('falls back to the default placeholder port when no storefront is selected', async () => {
        const responses = await getCiConfiguration('my-vendure-app', 'npm', 3000, undefined);

        expect(responses.storefrontPort).toBe(STOREFRONT_PORT);
        expect(responses.configSource).toContain(`http://localhost:${STOREFRONT_PORT}/verify`);
        expect(findAvailablePortMock).not.toHaveBeenCalled();
    });
});

describe('getQuickStartConfiguration', () => {
    afterEach(() => {
        vi.resetAllMocks();
        vi.restoreAllMocks();
    });

    it('exits when the Docker fallback prompt is cancelled', async () => {
        isDockerAvailableMock.mockResolvedValue({ result: 'not-running' });
        // Cancel the Docker fallback prompt only. Every later prompt answers normally, so
        // reaching one shows up below as that prompt having been asked.
        selectMock.mockImplementation(async (options: { message: string }) =>
            options.message === DOCKER_FALLBACK_PROMPT ? CANCELLED : 'none',
        );
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit');
        });

        const outcome = await getQuickStartConfiguration('my-vendure-app', 'npm', 3000).then(
            () => 'setup returned a configuration',
            (e: Error) => e.message,
        );

        // Which prompts were asked is the assertion that distinguishes the two behaviours. A
        // missed cancel carries on to the storefront prompt, which cancels correctly and also
        // exits with 0, so the exit alone does not show where the cancel was handled.
        expect(selectMock.mock.calls.map(([options]) => options.message)).toEqual([DOCKER_FALLBACK_PROMPT]);
        expect(outcome).toBe('process.exit');
        expect(cancelMock).toHaveBeenCalledWith('Setup cancelled.');
        expect(exit).toHaveBeenCalledWith(0);
    });
});
