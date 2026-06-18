export type FetchPolicy = 'cache-first' | 'network-only' | 'cache-only' | 'no-cache' | 'standby';
export type WatchQueryFetchPolicy = FetchPolicy | 'cache-and-network';

export interface BaseExtensionMessage {
    requestId: string;
    type: string;
    data: any;
}

export interface ActiveRouteData {
    url: string;
    origin: string;
    pathname: string;
    params: { [key: string]: any };
    queryParams: { [key: string]: any };
    fragment: string | null;
}

export interface ActivatedRouteMessage extends BaseExtensionMessage {
    type: 'active-route';
}

export interface QueryMessage extends BaseExtensionMessage {
    type: 'graphql-query';
    data: {
        document: string;
        variables?: { [key: string]: any };
        fetchPolicy?: WatchQueryFetchPolicy;
    };
}

export interface MutationMessage extends BaseExtensionMessage {
    type: 'graphql-mutation';
    data: {
        document: string;
        variables?: { [key: string]: any };
    };
}

export interface NotificationMessage extends BaseExtensionMessage {
    type: 'notification';
    data: {
        message: string;
        translationVars?: { [key: string]: string | number };
        type?: 'info' | 'success' | 'error' | 'warning';
        duration?: number;
    };
}

export interface CancellationMessage extends BaseExtensionMessage {
    type: 'cancellation';
    data: null;
}

export interface DestroyMessage extends BaseExtensionMessage {
    type: 'destroy';
    data: null;
}

export type ExtensionMessage =
    | ActivatedRouteMessage
    | QueryMessage
    | MutationMessage
    | NotificationMessage
    | CancellationMessage
    | DestroyMessage;

export interface MessageResponse {
    requestId: string;
    data: any;
    complete: boolean;
    error: boolean;
}
