import { createContext, useEffect } from 'react';
import { useUserSettings } from '../hooks/use-user-settings.js';

export type Theme = 'dark' | 'light' | 'system';

type ThemeProviderProps = {
    children: React.ReactNode;
    defaultTheme?: Theme;
    storageKey?: string;
};

type ThemeProviderState = {
    theme: Theme;
    setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
    theme: 'system',
    setTheme: () => null,
};

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({ children, defaultTheme = 'system', ...props }: Readonly<ThemeProviderProps>) {
    const { settings, setTheme } = useUserSettings();

    useEffect(() => {
        const root = window.document.documentElement;

        root.classList.remove('light', 'dark');

        const activeTheme =
            defaultTheme !== 'system' && settings.theme === 'system' ? defaultTheme : settings.theme;

        if (activeTheme === 'system') {
            const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

            root.classList.add(systemTheme);
            return;
        }

        root.classList.add(activeTheme);
    }, [settings.theme, defaultTheme]);

    return (
        <ThemeProviderContext.Provider
            {...props}
            value={{
                theme: settings.theme,
                setTheme: setTheme,
            }}
        >
            {children}
        </ThemeProviderContext.Provider>
    );
}
