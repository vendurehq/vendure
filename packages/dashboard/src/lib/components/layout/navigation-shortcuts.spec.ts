import { describe, expect, it, vi } from 'vitest';

import {
    NavigationShortcut,
    NavMenuItem,
    NavMenuSection,
} from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { buildShortcutMap, isEditableTarget } from './navigation-shortcuts.js';

const item = (id: string, shortcut?: NavigationShortcut): NavMenuItem => ({
    id,
    title: id,
    url: `/${id}`,
    shortcut,
});

describe('navigation shortcuts', () => {
    it('includes visible built-in and extension items nested in sections', () => {
        const section: NavMenuSection = {
            id: 'section',
            title: 'Section',
            items: [item('products', 'p'), item('extension', 'x')],
        };
        const map = buildShortcutMap([section, item('dashboard', 'd')]);

        expect([...map.keys()]).toEqual(['p', 'x', 'd']);
    });

    it('suppresses every destination for a conflicting key', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const map = buildShortcutMap([item('products', 'p'), item('plugin-products', 'p')]);

        expect(map.has('p')).toBe(false);
    });

    it('only builds shortcuts from the permission-filtered registry it receives', () => {
        const allowed = item('orders', 'o');
        const denied = item('settings', 's');
        const permissionFilteredItems = [allowed].filter(value => value !== denied);

        expect([...buildShortcutMap(permissionFilteredItems).values()]).toEqual([allowed]);
    });

    it('recognizes form fields and contenteditable descendants', () => {
        const input = document.createElement('input');
        const editor = document.createElement('div');
        const child = document.createElement('span');
        editor.setAttribute('contenteditable', 'true');
        editor.append(child);

        expect(isEditableTarget(input)).toBe(true);
        expect(isEditableTarget(child)).toBe(true);
        expect(isEditableTarget(document.body)).toBe(false);
    });
});
