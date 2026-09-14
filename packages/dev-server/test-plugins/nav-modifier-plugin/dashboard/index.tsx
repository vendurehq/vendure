import { defineDashboardExtension, NavMenuConfig } from '@vendure/dashboard';
import { ShieldCheck } from 'lucide-react';

/**
 * Demonstrates the function form of `navSections`.
 *
 * This moves the "Administrators" and "Roles" nav items (from the "Settings"
 * section) and "API Keys" (from the "System" section) into a new
 * "Access & Identity" section.
 */
defineDashboardExtension({
    navSections: (config: NavMenuConfig): NavMenuConfig => {
        const idsToMove = ['administrators', 'roles', 'api-keys'];

        // Extract the items we want to move from whichever sections hold them
        const movedItems = config.sections.flatMap(section =>
            'items' in section ? (section.items ?? []).filter(i => idsToMove.includes(i.id)) : [],
        );

        return {
            sections: [
                // Keep all existing sections, but remove the moved items
                ...config.sections.map(section =>
                    'items' in section
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
