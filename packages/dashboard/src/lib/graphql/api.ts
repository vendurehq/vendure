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

const awesomeClient = new AwesomeGraphQLClient({
    endpoint: API_URL,
    fetch: async (url: string, options: RequestInit = {}) => {
        // Get the active channel token from localStorage
        const channelToken = localStorage.getItem(LS_KEY_SELECTED_CHANNEL_TOKEN);
        const sessionToken = localStorage.getItem(LS_KEY_SESSION_TOKEN);
        const headers = new Headers(options.headers);

        if (sessionToken) {
            headers.set('Authorization', `Bearer ${sessionToken}`);
        }
        if (channelToken) {
            headers.set(uiConfig.api.channelTokenKey, channelToken);
        }

        // Get the content language from user settings and add as query parameter
        let finalUrl = url;
        try {
            const userSettings = localStorage.getItem(LS_KEY_USER_SETTINGS);
            if (userSettings) {
                const settings = JSON.parse(userSettings);
                const contentLanguage = settings.contentLanguage;

                if (contentLanguage) {
                    const urlObj = new URL(finalUrl);
                    urlObj.searchParams.set('languageCode', contentLanguage);
                    finalUrl = urlObj.toString();
                }
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('Failed to read content language from user settings:', error);
        }

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
    if (err instanceof Error) {
        if ((err as any).extensions?.code === 'CHANNEL_NOT_FOUND') {
            localStorage.removeItem(LS_KEY_SELECTED_CHANNEL_TOKEN);
        }
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

export const api = {
    query,
    mutate,
};
