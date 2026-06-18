import { useResolvedTheme } from '@/vdb/hooks/use-theme.js';
import { JsonEditor, type JsonEditorProps, githubDarkTheme, githubLightTheme } from 'json-edit-react';
import { useMemo } from 'react';

const FONT_OVERRIDE = { fontFamily: 'var(--font-mono)', backgroundColor: 'transparent' };

export function JsonViewer(props: Readonly<JsonEditorProps>) {
    const resolvedTheme = useResolvedTheme();
    const theme = useMemo(() => {
        const baseTheme = resolvedTheme === 'dark' ? githubDarkTheme : githubLightTheme;
        // json-edit-react's container style can be a string (shorthand for backgroundColor)
        // or an object — normalize to object before merging
        const baseContainer =
            typeof baseTheme.styles.container === 'string'
                ? { backgroundColor: baseTheme.styles.container }
                : baseTheme.styles.container;
        return {
            ...baseTheme,
            styles: {
                ...baseTheme.styles,
                container: { ...baseContainer, ...FONT_OVERRIDE },
            },
        };
    }, [resolvedTheme]);
    return <JsonEditor {...props} theme={theme} />;
}
