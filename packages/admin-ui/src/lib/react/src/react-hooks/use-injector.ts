import { ProviderToken } from '@angular/core';
import { useContext } from 'react';
import { HostedComponentContext } from '../directives/react-component-host.directive';

/**
 * @description
 * Exposes the Angular injector which allows the injection of services into React components.
 *
 * @example
 * ```ts
 * import { useInjector } from '\@vendure/admin-ui/react';
 * import { NotificationService } from '\@vendure/admin-ui/core';
 *
 * export const MyComponent = () => {
 *     const notificationService = useInjector(NotificationService);
 *
 *     const handleClick = () => {
 *         notificationService.success('Hello world!');
 *     };
 *     // ...
 *     return <div>...</div>;
 * }
 * ```
 *
 * @docsCategory react-hooks
 */
export function useInjector<T = any>(token: ProviderToken<T>): T {
    const context = useContext(HostedComponentContext);
    const instance = context?.injector.get(token);
    if (!instance) {
        throw new Error(`Could not inject ${(token as any).name ?? token.toString()}`);
    }
    return instance;
}
