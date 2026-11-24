import { I18n, Messages, setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RolePermissionsDisplay } from './role-permissions-display.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/vdb/graphql/api.js', () => ({
    api: {
        query: vi.fn().mockResolvedValue({
            roles: {
                items: [
                    {
                        id: '1',
                        code: 'catalog-manager',
                        permissions: ['ReadCatalog'],
                        channels: [{ id: '1', code: '__default_channel__' }],
                    },
                ],
            },
        }),
    },
}));

vi.mock('@/vdb/components/shared/channel-code-label.js', () => ({
    ChannelCodeLabel: ({ code }: { code: string }) => <span>{code}</span>,
}));

vi.mock('@/vdb/hooks/use-grouped-permissions.js', () => ({
    useGroupedPermissions: () => [
        {
            id: 'section-catalog',
            label: 'Catalog',
            description: 'Grants permissions on Products, Facets, Assets, Collections',
            permissions: [
                { name: 'ReadCatalog', description: 'Grants permission to read Product', assignable: true },
            ],
        },
    ],
}));

describe('RolePermissionsDisplay', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        vi.unstubAllEnvs();
        warn.mockRestore();
    });

    function productionI18n(messages: Messages): I18n {
        vi.stubEnv('NODE_ENV', 'production');
        const i18n = setupI18n();
        i18n.loadAndActivate({ locale: 'en', messages });
        return i18n;
    }

    async function render(i18n: I18n) {
        await act(async () => {
            root.render(
                <I18nProvider i18n={i18n}>
                    <QueryClientProvider client={new QueryClient()}>
                        <RolePermissionsDisplay value={['1']} />
                    </QueryClientProvider>
                </I18nProvider>,
            );
        });
        await act(async () => {
            await vi.waitFor(() => expect(container.textContent).toContain('__default_channel__'));
        });
    }

    function uncompiledWarnings() {
        return warn.mock.calls.filter(([message]) => String(message).includes('Uncompiled message detected'));
    }

    it('shows server-provided permission names as they are when the catalog has no entry', async () => {
        await render(productionI18n({}));

        expect(container.textContent).toContain('ReadCatalog');
        expect(uncompiledWarnings()).toHaveLength(0);
    });

    it('translates permission names that have a catalog entry', async () => {
        await render(productionI18n({ ReadCatalog: ['Katalog lesen'] }));

        expect(container.textContent).toContain('Katalog lesen');
        expect(uncompiledWarnings()).toHaveLength(0);
    });
});
