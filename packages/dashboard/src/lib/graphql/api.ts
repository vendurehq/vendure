import {
    LS_KEY_SELECTED_CHANNEL_TOKEN,
    LS_KEY_SESSION_TOKEN,
    LS_KEY_USER_SETTINGS,
} from '@/vdb/constants.js';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { AwesomeGraphQLClient } from 'awesome-graphql-client';
import { DocumentNode, print } from 'graphql';
import { uiConfig } from 'virtual:vendure-ui-config';

import { getApiBaseUrl } from '../utils/config-utils.js';

const API_URL = getApiBaseUrl() + `/${uiConfig.api.adminApiPath}`;

export type Variables = object;
export type RequestDocument = string | DocumentNode;

// Shared by the fetch-based client below and by uploadWithProgress, so any
// header/URL logic added here (auth, channel token, content language) covers
// both request paths instead of silently missing one of them.

function buildRequestUrl(baseUrl: string): string {
    let url = baseUrl;
    try {
        const userSettings = localStorage.getItem(LS_KEY_USER_SETTINGS);
        if (userSettings) {
            const settings = JSON.parse(userSettings);
            const contentLanguage = settings.contentLanguage;
            if (contentLanguage) {
                const urlObj = new URL(url);
                urlObj.searchParams.set('languageCode', contentLanguage);
                url = urlObj.toString();
            }
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to read content language from user settings:', error);
    }
    return url;
}

// The content language selects which translation of the data to return; the display
// language tells the server which language to write its own descriptions and labels in.
// Accept-Language is set explicitly because browsers send one of their own from the OS
// locale, which would otherwise decide it.
function buildRequestHeaders(existing?: HeadersInit): Headers {
    const headers = new Headers(existing);
    const sessionToken = localStorage.getItem(LS_KEY_SESSION_TOKEN);
    const channelToken = localStorage.getItem(LS_KEY_SELECTED_CHANNEL_TOKEN);
    if (sessionToken) {
        headers.set('Authorization', `Bearer ${sessionToken}`);
    }
    if (channelToken) {
        headers.set(uiConfig.api.channelTokenKey, channelToken);
    }
    try {
        const userSettings = localStorage.getItem(LS_KEY_USER_SETTINGS);
        if (userSettings) {
            const settings = JSON.parse(userSettings);
            const displayLanguage = settings.displayLanguage;
            if (displayLanguage) {
                headers.set('Accept-Language', displayLanguage.replace(/_/g, '-'));
            }
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to read display language from user settings:', error);
    }
    return headers;
}

function isChannelNotFoundCode(code: unknown): boolean {
    return code === 'CHANNEL_NOT_FOUND';
}

const awesomeClient = new AwesomeGraphQLClient({
    endpoint: API_URL,
    fetch: async (url: string, options: RequestInit = {}) => {
        const headers = buildRequestHeaders(options.headers);
        const finalUrl = buildRequestUrl(url);

        return fetch(finalUrl, {
            ...options,
            headers,
            credentials: 'include',
            mode: 'cors',
        }).then(res => {
            const authToken = res.headers.get(uiConfig.api.authTokenHeaderKey);
            if (authToken) {
                localStorage.setItem(LS_KEY_SESSION_TOKEN, authToken);
            }
            return res;
        });
    },
});

/**
 * @description
 * Handles the scenario where there's an invalid channel token in local storage.
 * Most often seen in local development when testing multiple backends on the same
 * localhost origin.
 */
function handleInvalidChannelToken(err: unknown) {
    if (err instanceof Error && isChannelNotFoundCode((err as any).extensions?.code)) {
        localStorage.removeItem(LS_KEY_SELECTED_CHANNEL_TOKEN);
    }
}

export type VariablesAndRequestHeadersArgs<V extends Variables> =
    V extends Record<any, never>
        ? [variables?: V, requestHeaders?: HeadersInit]
        : [variables: V, requestHeaders?: HeadersInit];

function query<T, V extends Variables = Variables>(
    document: RequestDocument | TypedDocumentNode<T, V>,
    variables?: V,
): Promise<T> {
    const documentString = typeof document === 'string' ? document : print(document);
    return awesomeClient.request(documentString, variables).catch(err => {
        handleInvalidChannelToken(err);
        throw err;
    }) as any;
}

function mutate<T, V extends Variables = Variables>(
    document: TypedDocumentNode<T, V>,
): (variables: V) => Promise<T>;
function mutate(document: RequestDocument): (variables: Variables) => Promise<unknown>;
function mutate<T, V extends Variables = Variables>(
    document: TypedDocumentNode<T, V>,
    variables: V,
): Promise<T>;
function mutate(document: RequestDocument, variables: Variables): Promise<unknown>;
function mutate<T, V extends Variables = Variables>(
    document: RequestDocument | TypedDocumentNode<T, V>,
    maybeVariables?: V,
): Promise<T> | ((variables: V) => Promise<T>) {
    const documentString = typeof document === 'string' ? document : print(document);
    if (maybeVariables) {
        return awesomeClient.request(documentString, maybeVariables) as any;
    } else {
        return (variables: V): Promise<T> => {
            return awesomeClient.request(documentString, variables) as any;
        };
    }
}

// ─── Upload with progress ───────────────────────────────────────────────────
//
// XHR is used here instead of fetch because fetch has no upload.onprogress
// event. Header/URL/credentials logic is shared with the client above via
// buildRequestHeaders/buildRequestUrl so nothing added there is silently
// missed on this path.

export type UploadErrorCode =
    | 'FILE_TOO_LARGE'
    | 'HTTP_ERROR'
    | 'NETWORK_ERROR'
    | 'INVALID_RESPONSE'
    | 'TIMEOUT'
    | 'ABORTED'
    | 'SERVER_ERROR';

export type UploadWithProgressResult<T> =
    | { success: true; data: T }
    | { success: false; code: UploadErrorCode; detail?: string };

export interface UploadWithProgressOptions {
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
    // Total-request deadline, not an inactivity timeout — opt-in only, since a
    // large but still-progressing upload would otherwise be killed by a default.
    timeoutMs?: number;
}

// Walks a variables object, pulling out any File values per the GraphQL
// multipart request spec (https://github.com/jaydenseric/graphql-multipart-request-spec).
function extractFilesAndReplace(value: unknown, currentPath: string, files: Map<string, File>): unknown {
    if (value instanceof File) {
        files.set(currentPath, value);
        return null;
    }
    if (Array.isArray(value)) {
        return value.map((item, index) => extractFilesAndReplace(item, `${currentPath}.${index}`, files));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, val]) => [key, extractFilesAndReplace(val, `${currentPath}.${key}`, files)]),
        );
    }
    return value;
}

function buildMultipartUploadBody(documentString: string, variables: Variables): FormData {
    const files = new Map<string, File>();
    const cleanedVariables = extractFilesAndReplace(variables, 'variables', files);

    const body = new FormData();
    body.append('operations', JSON.stringify({ query: documentString, variables: cleanedVariables }));

    const fileEntries = [...files.entries()];
    const map = Object.fromEntries(fileEntries.map(([path], index) => [String(index), [path]]));
    body.append('map', JSON.stringify(map));
    fileEntries.forEach(([, file], index) => body.append(String(index), file, file.name));

    return body;
}

export function parseUploadResponse<T>(xhr: Pick<XMLHttpRequest, 'status' | 'responseText'>): UploadWithProgressResult<T> {
    if (xhr.status === 413) {
        return { success: false, code: 'FILE_TOO_LARGE' };
    }
    if (xhr.status < 200 || xhr.status >= 300) {
        return { success: false, code: 'HTTP_ERROR', detail: String(xhr.status) };
    }

    let json: any;
    try {
        json = JSON.parse(xhr.responseText);
    } catch {
        return { success: false, code: 'INVALID_RESPONSE' };
    }

    const graphqlError = json?.errors?.[0];
    if (graphqlError) {
        if (isChannelNotFoundCode(graphqlError.extensions?.code)) {
            localStorage.removeItem(LS_KEY_SELECTED_CHANNEL_TOKEN);
        }
        return { success: false, code: 'SERVER_ERROR', detail: graphqlError.message };
    }

    if (!json?.data) {
        return { success: false, code: 'INVALID_RESPONSE' };
    }

    return { success: true, data: json.data as T };
}

function uploadWithProgress<T, V extends Variables = Variables>(
    document: RequestDocument | TypedDocumentNode<T, V>,
    variables: V,
    { onProgress, signal, timeoutMs }: UploadWithProgressOptions = {},
): Promise<UploadWithProgressResult<T>> {
    const documentString = typeof document === 'string' ? document : print(document);

    return new Promise(resolve => {
        // An abort listener added below never fires for a signal that's
        // already aborted — without this check, an already-cancelled upload
        // would still be sent to the server.
        if (signal?.aborted) {
            resolve({ success: false, code: 'ABORTED' });
            return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open('POST', buildRequestUrl(API_URL));
        xhr.withCredentials = true;
        if (timeoutMs !== undefined) {
            xhr.timeout = timeoutMs;
        }
        buildRequestHeaders().forEach((value, key) => xhr.setRequestHeader(key, value));

        xhr.upload.onprogress = e => {
            if (e.lengthComputable) {
                onProgress?.(Math.round((e.loaded / e.total) * 100));
            }
        };

        const onAbortSignal = () => xhr.abort();
        signal?.addEventListener('abort', onAbortSignal);
        const cleanup = () => signal?.removeEventListener('abort', onAbortSignal);

        xhr.onload = () => {
            cleanup();
            resolve(parseUploadResponse<T>(xhr));
        };
        xhr.onerror = () => {
            cleanup();
            resolve({ success: false, code: 'NETWORK_ERROR' });
        };
        xhr.ontimeout = () => {
            cleanup();
            resolve({ success: false, code: 'TIMEOUT' });
        };
        xhr.onabort = () => {
            cleanup();
            resolve({ success: false, code: 'ABORTED' });
        };

        xhr.send(buildMultipartUploadBody(documentString, variables));
    });
}

export const api = {
    query,
    mutate,
    uploadWithProgress,
};
