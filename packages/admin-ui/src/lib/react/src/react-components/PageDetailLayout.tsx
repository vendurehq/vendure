import React, { PropsWithChildren, ReactNode } from 'react';

/**
 * @description
 * A responsive container for detail views with a main content area and an optional sidebar.
 *
 * @example
 * ```ts
 * import { PageDetailLayout } from '@vendure/admin-ui/react';
 *
 * export function MyComponent() {
 *   return (
 *     <PageDetailLayout sidebar={<div>Sidebar content</div>}>
 *       <div>Main content</div>
 *     </PageDetailLayout>
 *   );
 * }
 * ```
 *
 * @docsCategory react-components
 */
export function PageDetailLayout(props: PropsWithChildren<{ sidebar?: ReactNode }>) {
    return (
        <div className={'vdr-page-detail-layout'}>
            <div className="main">{props.children}</div>
            <div className="sidebar">{props.sidebar}</div>
        </div>
    );
}
