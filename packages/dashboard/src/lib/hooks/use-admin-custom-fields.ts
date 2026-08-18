import {
    addCustomFields,
    getCustomFieldsMap,
} from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

const activeAdministratorCustomFieldsDocument = graphql(`
    query ActiveAdministratorCustomFields {
        activeAdministrator {
            id
        }
    }
`);

/**
 * Loads the Administrator custom fields for the logged-in user.
 *
 * The document is derived lazily rather than at module scope on purpose. At
 * module-evaluation time the global custom fields map is still empty, because
 * CurrentUserQuery is the query that unblocks the serverConfig request which
 * populates it. Do not hoist the `addCustomFields` call.
 */
export function useAdminCustomFields(): {
    customFields: Record<string, unknown> | undefined;
    ready: boolean;
} {
    const serverConfig = useServerConfig();
    const { user } = useAuth();

    const document = useMemo(
        () =>
            addCustomFields(activeAdministratorCustomFieldsDocument, {
                customFieldsMap: getCustomFieldsMap(),
            }),
        [serverConfig],
    );

    const enabled = !!serverConfig && !!user?.id;

    const { data, isSuccess } = useQuery({
        queryKey: ['activeAdministratorCustomFields', user?.id],
        queryFn: () => api.query(document),
        enabled,
        // The global QueryClient sets placeholderData: keepPreviousData
        // (app/app-providers.tsx). This key carries administrator identity, so the
        // previous administrator's custom fields must not linger across a
        // logout/login. See packages/dashboard/CLAUDE.md, "React Query Defaults".
        placeholderData: undefined,
    });

    return {
        customFields: (data as any)?.activeAdministrator?.customFields ?? undefined,
        // When logged out there is nothing to wait for, so report ready.
        ready: !enabled || isSuccess,
    };
}
