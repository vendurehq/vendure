import { ActivatedRoute } from '@angular/router';
import { useEffect, useState } from 'react';
import { useInjector } from './use-injector';

/**
 * @description
 * Provides access to the current route params and query params.
 *
 * @example
 * ```ts
 * import { useRouteParams } from '\@vendure/admin-ui/react';
 * import React from 'react';
 *
 * export function MyComponent() {
 *     const { params, queryParams } = useRouteParams();
 *     // ...
 *     return <div>{ params.id }</div>;
 * }
 * ```
 *
 * @docsCategory react-hooks
 */
export function useRouteParams() {
    const activatedRoute = useInjector(ActivatedRoute);
    const [params, setParams] = useState(activatedRoute.snapshot.params);
    const [queryParams, setQueryParams] = useState(activatedRoute.snapshot.queryParams);

    useEffect(() => {
        const subscription = activatedRoute.params.subscribe(value => {
            setParams(value);
        });
        subscription.add(activatedRoute.queryParams.subscribe(value => setQueryParams(value)));
        return () => subscription.unsubscribe();
    }, []);

    return {
        params,
        queryParams,
    };
}
