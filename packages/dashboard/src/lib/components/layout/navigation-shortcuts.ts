import { NavMenuItem, NavMenuSection } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';

export function isEditableTarget(target: EventTarget | null) {
    return (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select, [contenteditable="true"]') ||
            target.closest('[contenteditable="true"]') !== null)
    );
}

export function buildShortcutMap(items: Array<NavMenuSection | NavMenuItem>) {
    const candidates: NavMenuItem[] = [];
    for (const item of items) {
        if ('url' in item) {
            candidates.push(item);
        } else {
            candidates.push(...(item.items ?? []));
        }
    }
    const grouped = new Map<string, NavMenuItem[]>();
    for (const item of candidates) {
        if (!item.shortcut || !/^[a-z0-9]$/.test(item.shortcut)) {
            if (item.shortcut && (import.meta as any).env?.DEV) {
                console.warn(`Ignoring invalid navigation shortcut "${item.shortcut}" for "${item.id}"`);
            }
            continue;
        }
        grouped.set(item.shortcut, [...(grouped.get(item.shortcut) ?? []), item]);
    }
    const result = new Map<string, NavMenuItem>();
    for (const [shortcut, matches] of grouped) {
        if (matches.length === 1) {
            result.set(shortcut, matches[0]);
        } else if ((import.meta as any).env?.DEV) {
            console.warn(
                `Ignoring conflicting navigation shortcut "G ${shortcut.toUpperCase()}" for ${matches.map(item => `"${item.id}"`).join(', ')}`,
            );
        }
    }
    return result;
}
