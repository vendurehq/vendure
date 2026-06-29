import { AlertsProvider } from '@/vdb/providers/alerts-provider.js';
import { AuthProvider } from '@/vdb/providers/auth.js';
import { ChannelProvider } from '@/vdb/providers/channel-provider.js';
import { I18nProvider } from '@/vdb/providers/i18n-provider.js';
import { ServerConfigProvider } from '@/vdb/providers/server-config.js';
import { ThemeProvider } from '@/vdb/providers/theme-provider.js';
import { UserSettingsProvider } from '@/vdb/providers/user-settings.js';
import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Keep the previously fetched data on screen while a query refetches
            // (e.g. when paginating, sorting, filtering, or changing a debounced
            // search term that is part of the queryKey). Without this, list
            // tables and selectors blank out for ~1 frame on every key change.
            placeholderData: keepPreviousData,
            // Tab-switching and reconnects are noisy on a long-lived dashboard
            // session and cause visible flashes. Individual queries can opt-in
            // again where it matters (e.g. polling).
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: React.ReactNode }) {
    return (
        <I18nProvider>
            <QueryClientProvider client={queryClient}>
                <UserSettingsProvider queryClient={queryClient}>
                    <ThemeProvider defaultTheme="system">
                        <AuthProvider>
                            <ServerConfigProvider>
                                <ChannelProvider>
                                    <AlertsProvider>{children}</AlertsProvider>
                                </ChannelProvider>
                            </ServerConfigProvider>
                        </AuthProvider>
                    </ThemeProvider>
                </UserSettingsProvider>
            </QueryClientProvider>
        </I18nProvider>
    );
}
