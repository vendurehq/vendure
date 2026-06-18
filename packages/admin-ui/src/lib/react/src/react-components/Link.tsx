import { Router } from '@angular/router';
import React, { PropsWithChildren } from 'react';
import { useInjector } from '../react-hooks/use-injector';

/**
 * @description
 * A React component which renders an anchor tag and navigates to the specified route when clicked.
 * This is useful when you want to use a React component in a Vendure UI plugin which navigates to
 * a route in the admin-ui.
 *
 * @example
 * ```ts
 * import { Link } from '@vendure/admin-ui/react';
 *
 * export const MyReactComponent = () => {
 *     return <Link href="/extensions/my-extension">Go to my extension</Link>;
 * }
 * ```
 *
 * @docsCategory react-components
 */
export function Link(props: PropsWithChildren<{ href: string; [props: string]: any }>) {
    const router = useInjector(Router);
    const { href, ...rest } = props;

    function onClick(e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        e.preventDefault();
        void router.navigateByUrl(href);
    }

    return (
        <a href={href} onClick={onClick} {...rest}>
            {props.children}
        </a>
    );
}
