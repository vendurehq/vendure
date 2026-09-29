import { i18n } from '@lingui/core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultLocale } from '../../providers/i18n-provider.js';
import { useDashboardExtensions } from './use-dashboard-extensions.js';

const runDashboardExtensions = vi.hoisted(() => vi.fn());

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('virtual:dashboard-extensions', () => ({
    runDashboardExtensions,
}));

vi.mock('./define-dashboard-extension.js', () => ({
    onExtensionSourceChange: vi.fn(),
}));

describe('useDashboardExtensions', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
    });

    it('can evaluate translations before the full locale catalog has loaded', async () => {
        let extensionError: unknown;

        runDashboardExtensions.mockImplementation(async () => {
            try {
                const extensionMessageId = ['Extension', 'label'].join(' ');
                i18n._(extensionMessageId);
            } catch (error) {
                extensionError = error;
            }
        });

        function DashboardBootstrap() {
            useDashboardExtensions();
            return null;
        }

        await act(async () => {
            root.render(<DashboardBootstrap />);
        });

        expect(runDashboardExtensions).toHaveBeenCalledOnce();
        expect(i18n.locale).toBe(defaultLocale);
        expect(extensionError).toBeUndefined();
    });
});
