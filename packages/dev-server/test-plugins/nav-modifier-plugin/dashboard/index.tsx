import { defineDashboardExtension, NavMenuConfig } from '@vendure/dashboard';
import { ShieldCheck } from 'lucide-react';

/**
 * Demonstrates the function form of `navSections`.
 *
 * This moves the "Administrators" and "Roles" nav items from the
 * "Settings" section into a new "Access & Identity" section.
 */
defineDashboardExtension({
    navSections: (config: NavMenuConfig): NavMenuConfig => {
        const idsToMove = ['administrators', 'roles'];

        // Find the settings section and extract the items we want to move
        const settings = config.sections.find(s => s.id === 'settings');
        const settingsItems = settings && 'items' in settings ? settings.items ?? [] : [];
        const movedItems = settingsItems.filter(i => idsToMove.includes(i.id));

        return {
            sections: [
                // Keep all existing sections, but remove the moved items from Settings
                ...config.sections.map(section =>
                    section.id === 'settings' && 'items' in section
                        ? { ...section, items: section.items?.filter(i => !idsToMove.includes(i.id)) }
                        : section,
                ),
                // Add the new section with the relocated items
                {
                    id: 'access-and-identity',
                    title: 'Access & Identity',
                    icon: ShieldCheck,
                    order: 150,
                    placement: 'bottom',
                    items: [...movedItems],
                },
            ],
        };
    },
});
