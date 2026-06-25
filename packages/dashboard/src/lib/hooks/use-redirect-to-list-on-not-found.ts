import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

export interface RedirectToListOnNotFoundOptions {
    /**
     * @description
     * Whether the underlying query is still in flight. The redirect is only
     * evaluated once the query has settled, so we don't bounce during the
     * initial load or a background refetch.
     */
    isLoading: boolean;
    /**
     * @description
     * When `true`, the hook is a no-op. Used to skip the check when creating
     * a new entity, where the absence of an entity is expected.
     */
    skip?: boolean;
}

/**
 * @description
 * Redirects to the entity list page when a detail entity is not found in the
 * active channel.
 *
 * This handles the case where a user switches to a channel in which the
 * currently-viewed entity does not exist: the detail query refetches, resolves
 * to no entity, and we navigate to the list rather than leaving the user on a
 * broken, empty detail view. When the entity _does_ exist in the target channel,
 * `entity` stays populated and no redirect occurs.
 *
 * The list path is derived as the first path segment (e.g. `/products/42` and
 * `/products/42/variants` both resolve to `/products`), falling back to the
 * dashboard root if that route does not exist.
 */
export function useRedirectToListOnNotFound(
    entity: unknown,
    { isLoading, skip }: RedirectToListOnNotFoundOptions,
): void {
    const navigate = useNavigate();
    const router = useRouter();
    const pathname = useRouterState({ select: s => s.location.pathname });

    useEffect(() => {
        if (skip || isLoading || entity) {
            return;
        }
        const segments = pathname.split('/').filter(Boolean);
        // Only redirect from a detail or sub-page (e.g. /products/42 or
        // /products/42/variants), never from a list page itself.
        if (segments.length <= 1 || segments[1] === NEW_ENTITY_PATH) {
            return;
        }
        const listPath = `/${segments[0]}`;
        const target = router.matchRoutes(listPath).length > 0 ? listPath : '/';
        // `to` is typed against the generated route tree, so a computed path
        // needs the cast.
        void navigate({ to: target as any });
    }, [entity, isLoading, skip, pathname, navigate, router]);
}
