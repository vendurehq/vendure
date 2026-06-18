import { ThemeProviderContext } from '@/vdb/providers/theme-provider.js';
import { useContext } from 'react';

export const useTheme = () => {
    const context = useContext(ThemeProviderContext);

    if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');

    return context;
};

/**
 * Returns the resolved theme ('dark' | 'light'), resolving 'system'
 * to the actual OS preference via matchMedia.
 */
export function useResolvedTheme(): 'dark' | 'light' {
    const { theme } = useTheme();
    if (theme !== 'system') return theme;
    return globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
