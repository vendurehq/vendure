const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Formats a shortcut definition like `mod+B` for the current platform. */
export function formatShortcut(shortcut: string): string {
    return shortcut
        .split('+')
        .map(key => {
            switch (key) {
                case 'mod':
                    return isMac ? '⌘' : 'Ctrl';
                case 'shift':
                    return isMac ? '⇧' : 'Shift';
                case 'alt':
                    return isMac ? '⌥' : 'Alt';
                default:
                    return key.toUpperCase();
            }
        })
        .join(isMac ? '' : '+');
}
