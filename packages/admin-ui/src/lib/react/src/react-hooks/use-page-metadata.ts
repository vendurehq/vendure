import { BreadcrumbValue } from '@vendure/admin-ui/core';
import { useContext } from 'react';
import { HostedComponentContext } from '../directives/react-component-host.directive';
import { HostedReactComponentContext, ReactRouteComponentOptions } from '../types';

/**
 * @description
 * Provides functions for setting the current page title and breadcrumb.
 *
 * @example
 * ```ts
 * import { usePageMetadata } from '\@vendure/admin-ui/react';
 * import { useEffect } from 'react';
 *
 * export const MyComponent = () => {
 *     const { setTitle, setBreadcrumb } = usePageMetadata();
 *     useEffect(() => {
 *         setTitle('My Page');
 *         setBreadcrumb([
 *             { link: ['./parent'], label: 'Parent Page' },
 *             { link: ['./'], label: 'This Page' },
 *         ]);
 *     }, []);
 *     // ...
 *     return <div>...</div>;
 * }
 * ```
 *
 * @docsCategory react-hooks
 */
export function usePageMetadata() {
    const context = useContext(
        HostedComponentContext,
    ) as HostedReactComponentContext<ReactRouteComponentOptions>;
    const setBreadcrumb = (newValue: BreadcrumbValue) => {
        context.pageMetadataService?.setBreadcrumbs(newValue);
    };
    const setTitle = (newTitle: string) => {
        context.pageMetadataService?.setTitle(newTitle);
    };

    return {
        setBreadcrumb,
        setTitle,
    };
}
