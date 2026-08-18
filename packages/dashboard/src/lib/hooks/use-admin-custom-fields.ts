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
 * @description
 * Loads the Administrator custom fields for the logged-in user.
 *
 * The document is derived lazily rather than at module scope on purpose. At
 * module-evaluation time the global custom fields map is still empty, because
 * CurrentUserQuery is the query that unblocks the serverConfig request which
 * populates it. Do not hoist the `addCustomFields` call.
 *
 * @docsCategory hooks
 * @docsPage useAdminCustomFields
 * @docsWeight 0
 * @since 3.8.0
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

    const { data, isSuccess, isError, fetchStatus } = useQuery({
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
        customFields: (data as any)?.activeAdministrator?.customFields,
        // When logged out there is nothing to wait for, so report ready. Note this is
        // based on login state alone, not `enabled` - `enabled` also waits on
        // serverConfig, and there is a real window where the user is logged in but
        // serverConfig hasn't resolved yet, during which custom fields have not loaded.
        //
        // Fail open. `ready` means "we are done waiting", not "we succeeded".
        // isError covers a settled failure; fetchStatus === 'paused' covers the
        // offline case, where the default networkMode leaves the query pending
        // forever with neither flag set. Holding the nav hostage to either is
        // worse than rendering it with custom fields absent.
        ready: !user?.id || isSuccess || isError || fetchStatus === 'paused',
    };
}
