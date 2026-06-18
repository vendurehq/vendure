import { ClarityIcons } from '@cds/core/icon';
import { IconShapeTuple } from '@cds/core/icon/interfaces/icon.interfaces';
import React, { DOMAttributes, useEffect } from 'react';

type CustomElement<T> = Partial<T & DOMAttributes<T> & { children: any }>;

export interface CdsIconProps {
    shape: string;
    size: string | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
    direction: 'up' | 'down' | 'left' | 'right';
    flip: 'horizontal' | 'vertical';
    solid: boolean;
    status: 'info' | 'success' | 'warning' | 'danger';
    inverse: boolean;
    badge: 'info' | 'success' | 'warning' | 'danger';
}

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            ['cds-icon']: CustomElement<CdsIconProps>;
        }
    }
}

export function registerCdsIcon(icon: IconShapeTuple) {
    ClarityIcons.addIcons(icon);
}

/**
 * @description
 * A React wrapper for the Clarity UI icon component.
 *
 * @example
 * ```ts
 * import { userIcon } from '@cds/core/icon';
 * import { CdsIcon } from '@vendure/admin-ui/react';
 *
 * registerCdsIcon(userIcon);
 * export function MyComponent() {
 *    return <CdsIcon icon={userIcon} badge="warning" solid size="lg"></CdsIcon>;
 * }
 * ```
 *
 * @docsCategory react-components
 */
export function CdsIcon(props: { icon: IconShapeTuple; className?: string } & Partial<CdsIconProps>) {
    const { icon, ...rest } = props;
    useEffect(() => {
        ClarityIcons.addIcons(icon);
    }, [icon]);
    return <cds-icon {...rest} shape={icon[0]}></cds-icon>;
}
