import { createPlatformPromotionState } from '@/vdb/framework/platform-promotion/platform-promotion.fixture.js';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { NavUser } from './nav-user.js';

// The menu content is in a closed popup. Rendering each menu part as its children (or as its
// `render` element) puts the menu entries in the static markup.
function Passthrough({ children, render }: { children?: React.ReactNode; render?: React.ReactElement }) {
    return render ? React.cloneElement(render, undefined, children) : <>{children}</>;
}

vi.mock('@/vdb/components/ui/dropdown-menu.js', () => ({
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuGroup: Passthrough,
    DropdownMenuItem: Passthrough,
    DropdownMenuLabel: Passthrough,
    DropdownMenuRadioGroup: Passthrough,
    DropdownMenuRadioItem: Passthrough,
    DropdownMenuSeparator: Passthrough,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: Passthrough,
    DropdownMenuTrigger: Passthrough,
}));

vi.mock('@/vdb/components/ui/sidebar.js', () => ({
    SidebarMenu: Passthrough,
    SidebarMenuButton: Passthrough,
    SidebarMenuItem: Passthrough,
    useSidebar: () => ({ isMobile: false, state: 'expanded' }),
}));

vi.mock('@/vdb/components/ui/dialog.js', () => ({ Dialog: Passthrough, DialogTrigger: Passthrough }));
vi.mock('./language-dialog.js', () => ({ LanguageDialog: () => null }));
vi.mock('@/vdb/components/shared/powered-by-vendure.js', () => ({ MenuBranding: () => null }));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
    useNavigate: () => vi.fn(),
    useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock('@/vdb/hooks/use-auth.js', () => ({
    useAuth: () => ({
        user: { firstName: 'Super', lastName: 'Admin', emailAddress: 'superadmin', avatar: null },
        logout: vi.fn(),
    }),
}));
vi.mock('@/vdb/hooks/use-display-locale.js', () => ({
    useDisplayLocale: () => ({ humanReadableLanguage: 'English' }),
}));
vi.mock('@/vdb/hooks/use-user-settings.js', () => ({
    useUserSettings: () => ({ settings: { theme: 'system', devMode: false }, setTheme: vi.fn(), setDevMode: vi.fn() }),
}));

// All locked Platform items are hidden: the Dashboard opt-out, or License Guard without a report.
vi.mock('@/vdb/hooks/use-platform-promotion.js', () => ({
    usePlatformPromotion: () => createPlatformPromotionState([], true),
    getPlatformPromotion: () => createPlatformPromotionState([], true),
}));

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

describe('NavUser', () => {
    // OSS-891: the Platform opt-out hides the locked items, but not the "Plans" entry.
    it('keeps the "Plans" entry when all locked Platform items are hidden', () => {
        const markup = renderToStaticMarkup(
            <I18nProvider i18n={i18n}>
                <NavUser />
            </I18nProvider>,
        );
        expect(markup).toContain('aria-label="Plans"');
        expect(markup).toContain('href="https://vendure.io/pricing?utm_source=vendure-dashboard"');
    });
});
