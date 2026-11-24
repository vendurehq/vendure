import { I18n, Messages, setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionsTableGrid } from './permissions-table-grid.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/vdb/hooks/use-grouped-permissions.js', () => ({
    useGroupedPermissions: () => [
        {
            id: 'section-product',
            label: 'Product',
            description: 'Grants permissions on Product',
            permissions: [
                {
                    name: 'CreateProduct',
                    description: 'Grants permission to create Product',
                    assignable: true,
                },
                { name: 'ReadProduct', description: 'Grants permission to read Product', assignable: true },
            ],
        },
        {
            id: 'section-superadmin',
            label: 'SuperAdmin',
            description: 'SuperAdmin has unrestricted access to all operations',
            permissions: [
                {
                    name: 'SuperAdmin',
                    description: 'SuperAdmin has unrestricted access to all operations',
                    assignable: true,
                },
            ],
        },
    ],
}));

describe('PermissionsTableGrid', () => {
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
        vi.restoreAllMocks();
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
                    <PermissionsTableGrid value={['ReadProduct']} onChange={() => undefined} readonly />
                </I18nProvider>,
            );
        });
    }

    function uncompiledWarnings() {
        return warn.mock.calls.filter(([message]) => String(message).includes('Uncompiled message detected'));
    }

    it('shows server-provided permission texts as they are when the catalog has no entry', async () => {
        await render(productionI18n({}));

        expect(uncompiledWarnings()).toHaveLength(0);
        expect(container.textContent).toContain('Product');
        expect(container.textContent).toContain('SuperAdmin');
    });

    it('translates permission texts that have a catalog entry', async () => {
        await render(productionI18n({ Product: ['Produkt'], SuperAdmin: ['Superadministrator'] }));

        expect(uncompiledWarnings()).toHaveLength(0);
        expect(container.textContent).toContain('Produkt');
        expect(container.textContent).toContain('Superadministrator');
    });
});
