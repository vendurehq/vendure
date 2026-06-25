import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

export interface RedirectToListOnNotFoundOptions {
    /**
     * @description
     * Whether the underlying query is currently fetching. Pass the query's
     * `isFetching` flag (true on the initial load _and_ on background refetches).
     * The redirect is only evaluated once the query has settled, so we don't
     * bounce during the initial load or while a channel-switch refetch is in
     * flight.
     */
    isFetching: boolean;
    /**
     * @description
     * When `true`, the hook is a no-op. Pass `skip: true` when the absence of an
     * entity is expected, e.g. when creating a new entity.
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
 * The list route is assumed to live at the first path segment (e.g. `/products`),
 * so `/products/42` and `/products/42/variants` both resolve to `/products`. If
 * that route does not exist, it falls back to the dashboard root.
 */
export function useRedirectToListOnNotFound(
    entity: unknown,
    { isFetching, skip }: RedirectToListOnNotFoundOptions,
): void {
    const navigate = useNavigate();
    const router = useRouter();
    const pathname = useRouterState({ select: s => s.location.pathname });
    // The pathname is read when computing the redirect target, but it must not
    // trigger the effect: the redirect should fire on a not-found transition,
    // not on every navigation. A ref keeps the latest value without a dep.
    const pathnameRef = useRef(pathname);
    pathnameRef.current = pathname;

    useEffect(() => {
        if (skip || isFetching || entity) {
            return;
        }
        const segments = pathnameRef.current.split('/').filter(Boolean);
        // Only redirect from a detail or sub-page (e.g. /products/42 or
        // /products/42/variants), never from a list page (single segment).
        if (segments.length <= 1) {
            return;
        }
        const listPath = `/${segments[0]}`;
        const target = router.matchRoutes(listPath).length > 0 ? listPath : '/';
        // `to` is typed against the generated route tree, so a computed path
        // needs the cast.
        void navigate({ to: target as any });
    }, [entity, isFetching, skip, navigate, router]);
}
