import {
    ActiveRouteData,
    BaseExtensionMessage,
    ExtensionMessage,
    MessageResponse,
    NotificationMessage,
    WatchQueryFetchPolicy,
} from '@vendure/common/lib/extension-host-types';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';

let targetOrigin = 'http://localhost:3000';

/**
 * @description
 * Set the [window.postMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
 * `targetOrigin`. The Vendure ui-devkit uses the postMessage API to
 * enable cross-frame and cross-origin communication between the ui extension code and the Admin UI
 * app. The `targetOrigin` is a security feature intended to provide control over where messages are sent.
 *
 * @docsCategory ui-devkit
 * @docsPage UiDevkitClient
 */
export function setTargetOrigin(value: string) {
    targetOrigin = value;
}

/**
 * @description
 * Retrieves information about the current route of the host application, since it is not possible
 * to otherwise get this information from within the child iframe.
 *
 * @example
 * ```ts
 * import { getActivatedRoute } from '\@vendure/ui-devkit';
 *
 * const route = await getActivatedRoute();
 * const slug = route.params.slug;
 * ```
 * @docsCategory ui-devkit
 * @docsPage UiDevkitClient
 */
export function getActivatedRoute(): Promise<ActiveRouteData> {
    return sendMessage('active-route', {}).toPromise();
}

/**
 * @description
 * Perform a GraphQL query and returns either an Observable or a Promise of the result.
 *
 * @example
 * ```ts
 * import { graphQlQuery } from '\@vendure/ui-devkit';
 *
 * const productList = await graphQlQuery(`
 *   query GetProducts($skip: Int, $take: Int) {
 *       products(options: { skip: $skip, take: $take }) {
 *           items { id, name, enabled },
 *           totalItems
 *       }
 *   }`, {
 *     skip: 0,
 *     take: 10,
 *   }).then(data => data.products);
 * ```
 *
 * @docsCategory ui-devkit
 * @docsPage UiDevkitClient
 */
export function graphQlQuery<T, V extends { [key: string]: any }>(
    document: string,
    variables?: { [key: string]: any },
    fetchPolicy?: WatchQueryFetchPolicy,
): {
    then: Promise<T>['then'];
    stream: Observable<T>;
} {
    const result$ = sendMessage('graphql-query', { document, variables, fetchPolicy });
    return {
        then: (...args: any[]) =>
            result$
                .pipe(take(1))
                .toPromise()
                .then(...args),
        stream: result$,
    };
}

/**
 * @description
 * Perform a GraphQL mutation and returns either an Observable or a Promise of the result.
 *
 * @example
 * ```ts
 * import { graphQlMutation } from '\@vendure/ui-devkit';
 *
 * const disableProduct = (id: string) => {
 *   return graphQlMutation(`
 *     mutation DisableProduct($id: ID!) {
 *       updateProduct(input: { id: $id, enabled: false }) {
 *         id
 *         enabled
 *       }
 *     }`, { id })
 *     .then(data => data.updateProduct)
 * }
 * ```
 *
 * @docsCategory ui-devkit
 * @docsPage UiDevkitClient
 */
export function graphQlMutation<T, V extends { [key: string]: any }>(
    document: string,
    variables?: { [key: string]: any },
): {
    then: Promise<T>['then'];
    stream: Observable<T>;
} {
    const result$ = sendMessage('graphql-mutation', { document, variables });
    return {
        then: (...args: any[]) =>
            result$
                .pipe(take(1))
                .toPromise()
                .then(...args),
        stream: result$,
    };
}

/**
 * @description
 * Display a toast notification.
 *
 * @example
 * ```ts
 * import { notify } from '\@vendure/ui-devkit';
 *
 * notify({
 *   message: 'Updated Product',
 *   type: 'success'
 * });
 * ```
 *
 * @docsCategory ui-devkit
 * @docsPage UiDevkitClient
 */
export function notify(options: NotificationMessage['data']): void {
    void sendMessage('notification', options).toPromise();
}

function sendMessage<T extends ExtensionMessage>(type: T['type'], data: T['data']): Observable<any> {
    const requestId = type + '__' + Math.random().toString(36).substr(3);
    const message: BaseExtensionMessage = {
        requestId,
        type,
        data,
    };

    return new Observable<any>(subscriber => {
        const hostWindow = window.opener || window.parent;
        const handleReply = (event: MessageEvent) => {
            const response: MessageResponse = event.data;
            if (response && response.requestId === requestId) {
                if (response.complete) {
                    subscriber.complete();
                    tearDown();
                    return;
                }
                if (response.error) {
                    subscriber.error(response.data);
                    tearDown();
                    return;
                }
                subscriber.next(response.data);
            }
        };
        const tearDown = () => {
            hostWindow.postMessage({ requestId, type: 'cancellation', data: null }, targetOrigin);
        };
        window.addEventListener('message', handleReply);
        hostWindow.postMessage(message, targetOrigin);

        return tearDown;
    });
}
