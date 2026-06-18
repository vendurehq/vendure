import React from 'react';
import { useComponentRegistry } from './component-registry.js';

/**
 * @description
 * This component is used to delegate the rendering of a component to the component registry.
 *
 * @example
 * ```ts
 * <Delegate component="money.display.default" value={100} />
 * ```
 *
 * @returns
 */
export function DisplayComponent(
    props: Readonly<{
        id: string;
        value: any;
    }>,
): React.ReactNode {
    const { getDisplayComponent } = useComponentRegistry();
    const Component = getDisplayComponent(props.id.toString());
    if (!Component) {
        throw new Error(`Component with id ${props.id.toString()} not found`);
    }
    const { value, ...rest } = props;
    return <Component value={value} {...rest} />;
}
