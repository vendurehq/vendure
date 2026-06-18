import React, { PropsWithChildren } from 'react';

/**
 * @description
 * A container for page content which provides a consistent width and spacing.
 *
 * @example
 * ```ts
 * import { PageBlock } from '@vendure/admin-ui/react';
 *
 * export function MyComponent() {
 *   return (
 *     <PageBlock>
 *       ...
 *     </PageBlock>
 *   );
 * }
 * ```
 *
 * @docsCategory react-components
 */
export function PageBlock(props: PropsWithChildren) {
    return <div className="page-block">{props.children}</div>;
}
