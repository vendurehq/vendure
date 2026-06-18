import { ServerConfig } from '@/vdb/providers/server-config.js';
import { useMemo } from 'react';

import { useServerConfig } from './use-server-config.js';

export function useGroupedPermissions() {
    const serverConfig = useServerConfig();
    const permissionDefinitions = serverConfig?.permissions ?? [];
    const extractCrudDescription = (def: ServerConfig['permissions'][number]): string => {
        return def.description.replace(/Grants permission to [\w]+/, 'Grants permissions on');
    };

    const groupedPermissions = useMemo(() => {
        const crudGroups = new Map<string, ServerConfig['permissions']>();
        const nonCrud: ServerConfig['permissions'] = [];
        const crudRe = /^(Create|Read|Update|Delete)([a-zA-Z]+)$/;

        for (const def of permissionDefinitions) {
            const isCrud = crudRe.test(def.name);
            if (isCrud) {
                const groupName = def.name.match(crudRe)?.[2];
                if (groupName) {
                    const existing = crudGroups.get(groupName);
                    if (existing) {
                        existing.push(def);
                    } else {
                        crudGroups.set(groupName, [def]);
                    }
                }
            } else if (def.assignable) {
                nonCrud.push(def);
            }
        }

        return [
            ...nonCrud.map(d => ({
                label: d.name,
                description: d.description,
                permissions: [d],
            })),
            ...Array.from(crudGroups.entries()).map(([label, defs]) => ({
                label,
                description: extractCrudDescription(defs[0]),
                permissions: defs.sort((a, b) => a.name.localeCompare(b.name)),
            })),
        ]
            .sort((a, b) => a.label.localeCompare(b.label))
            .map(d => ({
                ...d,
                id: `section-${d.label.toLowerCase().replace(/ /g, '-')}`,
            }));
    }, [permissionDefinitions]);

    return groupedPermissions;
}
