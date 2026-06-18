import React, { PropsWithChildren } from 'react';

/**
 * @description
 * A card component which can be used to group related content.
 *
 * @example
 * ```ts
 * import { Card } from '@vendure/admin-ui/react';
 *
 * export function MyComponent() {
 *   return (
 *     <Card title='My Title'>
 *       <p>Some content</p>
 *     </Card>
 *   );
 * }
 * ```
 *
 * @docsCategory react-components
 */
export function Card(props: PropsWithChildren<{ title?: string; paddingX?: boolean }>) {
    return (
        <div className={'vdr-card'}>
            <div className={`card-container ${props.paddingX !== false ? 'padding-x' : ''}`}>
                {props.title && (
                    <div className={'title-row'}>
                        <div className="title">{props.title}</div>
                    </div>
                )}
                <div className="contents">{props.children}</div>
            </div>
        </div>
    );
}
