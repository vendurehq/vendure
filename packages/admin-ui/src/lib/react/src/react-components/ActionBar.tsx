import React, { PropsWithChildren, ReactNode } from 'react';

/**
 * @description
 * A container for the primary actions on a list or detail page
 *
 * @example
 * ```ts
 * import { ActionBar } from '@vendure/admin-ui/react';
 *
 * export function MyComponent() {
 *   return (
 *     <ActionBar leftContent={<div>Optional left content</div>}>
 *       <button className='button primary'>Primary action</button>
 *     </ActionBar>
 *   );
 * }
 * ```
 *
 * @docsCategory react-components
 */
export function ActionBar(props: PropsWithChildren<{ leftContent?: ReactNode }>) {
    return (
        <div className={'vdr-action-bar'}>
            <div className="left-content">{props.leftContent}</div>
            <div className="right-content">{props.children}</div>
        </div>
    );
}
