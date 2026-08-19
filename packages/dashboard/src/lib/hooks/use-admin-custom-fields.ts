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
 * Narrows the response to the Administrator custom fields. `addCustomFields` grafts the
 * selections on at runtime, so the generated result type cannot describe them.
 */
function readAdminCustomFields(data: unknown): Record<string, unknown> | undefined {
    if (typeof data !== 'object' || data === null || !('activeAdministrator' in data)) {
        return undefined;
    }
    const administrator = (data as { activeAdministrator: unknown }).activeAdministrator;
    if (typeof administrator !== 'object' || administrator === null || !('customFields' in administrator)) {
        return undefined;
    }
    const customFields = (administrator as { customFields: unknown }).customFields;
    if (typeof customFields !== 'object' || customFields === null) {
        return undefined;
    }
    return customFields as Record<string, unknown>;
}

/**
 * Internal. Loads the Administrator custom fields for the logged-in user.
 *
 * Deliberately not part of the public API. It returns an untyped
 * `Record<string, unknown>`, and its `ready` flag means "we have stopped waiting",
 * not "we succeeded". Consumers should use `useDashboardUserContext()` and read
 * `ctx.administrator.customFields`, which is typed and correctly gated.
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

    // Keyed on the map, not on serverConfig: main.tsx fills the map in an effect, so a
    // serverConfig-keyed memo runs a render too early and bakes in an empty map.
    const customFieldsMap = getCustomFieldsMap();

    const document = useMemo(
        () => addCustomFields(activeAdministratorCustomFieldsDocument, { customFieldsMap }),
        [customFieldsMap],
    );

    // The selection set changes with the custom field config, so the cache key must too.
    const customFieldSignature = useMemo(
        () =>
            (customFieldsMap.get('Administrator') ?? [])
                .map(field => field.name)
                .sort((a, b) => a.localeCompare(b))
                .join(','),
        [customFieldsMap],
    );

    const enabled = !!serverConfig && !!user?.id;

    const { data, isSuccess, isError, fetchStatus } = useQuery({
        queryKey: ['activeAdministratorCustomFields', user?.id, customFieldSignature],
        queryFn: () => api.query(document),
        enabled,
        // Fail open promptly. Without this the query inherits the default of 3
        // retries, so `isError` - and therefore `ready` - would not arrive for
        // several seconds of backoff, leaving the nav blank for exactly the
        // stretch the fail-open exists to prevent. Matches every other query in
        // this package, which all pin retry: false.
        retry: false,
        // The global QueryClient sets placeholderData: keepPreviousData
        // (app/app-providers.tsx). This key carries administrator identity, so the
        // previous administrator's custom fields must not linger across a
        // logout/login. See packages/dashboard/CLAUDE.md, "React Query Defaults".
        placeholderData: undefined,
    });

    return {
        customFields: readAdminCustomFields(data),
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
