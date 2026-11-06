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
    const customFields = (data as { activeAdministrator?: { customFields?: unknown } } | undefined)
        ?.activeAdministrator?.customFields;
    return customFields ? (customFields as Record<string, unknown>) : undefined;
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
 *
 * Pass `enabled: false` when nothing will read the result, to skip the request
 * altogether. `ready` is then true immediately, since there is nothing to wait for.
 */
export function useAdminCustomFields({ enabled: enabledByCaller = true }: { enabled?: boolean } = {}): {
    customFields: Record<string, unknown> | undefined;
    ready: boolean;
} {
    const serverConfig = useServerConfig();
    const { user } = useAuth();

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

    const enabled = enabledByCaller && !!serverConfig && !!user?.id;

    const { data, isSuccess, isError, fetchStatus } = useQuery({
        queryKey: ['activeAdministratorCustomFields', user?.id, customFieldSignature],
        queryFn: () => api.query(document),
        enabled,
        // Without this the default of 3 retries delays `isError`, and so `ready`, by
        // several seconds of backoff, which is the stretch the fail-open exists to end.
        retry: false,
        // Overrides the global keepPreviousData default: this key carries administrator
        // identity, so the previous administrator's fields must not linger across a login.
        placeholderData: undefined,
    });

    return {
        customFields: readAdminCustomFields(data),
        // `ready` means "done waiting", not "succeeded". The check is on login state
        // rather than `enabled`: `enabled` also waits on serverConfig, and while that is
        // unresolved the fields genuinely have not loaded. `fetchStatus === 'paused'` is
        // the offline case, where the default networkMode leaves the query pending with
        // neither isSuccess nor isError ever set.
        ready: !enabledByCaller || !user?.id || isSuccess || isError || fetchStatus === 'paused',
    };
}
