import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { SUPER_ADMIN_USER_IDENTIFIER, SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import { VendureConfig } from '@vendure/core';
import FormData from 'form-data';
import fs from 'fs';
import { DocumentNode } from 'graphql';
import { print } from 'graphql/language/printer';
import gql from 'graphql-tag';
import fetch, { RequestInit, Response } from 'node-fetch';
import { stringify } from 'querystring';

import { QueryParams } from './types';
import { createUploadPostData } from './utils/create-upload-post-data';

const LOGIN = gql`
    mutation ($username: String!, $password: String!) {
        login(username: $username, password: $password) {
            ... on CurrentUser {
                id
                identifier
                channels {
                    token
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

/* eslint-disable no-console */
/**
 * @description
 * A minimalistic GraphQL client for populating and querying test data.
 *
 * @docsCategory testing
 */
export class SimpleGraphQLClient {
    private authToken: string;
    private channelToken: string | null = null;
    private headers: { [key: string]: any } = {
        'Apollo-Require-Preflight': 'true',
    };

    constructor(
        private vendureConfig: Required<VendureConfig>,
        private apiUrl: string = '',
    ) {}

    /**
     * @description
     * Sets the authToken to be used in each GraphQL request.
     */
    setAuthToken(token: string) {
        this.authToken = token;
        this.headers.Authorization = `Bearer ${this.authToken}`;
    }

    /**
     * @description
     * Sets the authToken to be used in each GraphQL request.
     */
    setChannelToken(token: string | null) {
        this.channelToken = token;
        if (this.vendureConfig.apiOptions.channelTokenKey) {
            this.headers[this.vendureConfig.apiOptions.channelTokenKey] = this.channelToken;
        }
    }

    /**
     * @description
     * Returns the authToken currently being used.
     */
    getAuthToken(): string {
        return this.authToken;
    }

    /**
     * @description
     * Performs both query and mutation operations.
     */
    async query<T = any, V extends Record<string, any> = Record<string, any>>(
        query: DocumentNode | TypedDocumentNode<T, V>,
        variables?: V,
        queryParams?: QueryParams,
    ): Promise<T> {
        const response = await this.makeGraphQlRequest(query, variables, queryParams);
        const result = await this.getResult(response);

        if (response.ok && !result.errors && result.data) {
            return result.data;
        } else {
            const errorResult = typeof result === 'string' ? { error: result } : result;
            throw new ClientError(
                { ...errorResult, status: response.status },
                { query: print(query), variables },
            );
        }
    }

    /**
     * @description
     * Performs a raw HTTP request to the given URL, but also includes the authToken & channelToken
     * headers if they have been set. Useful for testing non-GraphQL endpoints, e.g. for plugins
     * which make use of REST controllers.
     */
    async fetch(url: string, options: RequestInit = {}): Promise<Response> {
        const headers = { 'Content-Type': 'application/json', ...this.headers, ...options.headers };

        const response = await fetch(url, {
            ...options,
            headers,
        });
        const authToken = response.headers.get(this.vendureConfig.authOptions.authTokenHeaderKey || '');
        if (authToken != null) {
            this.setAuthToken(authToken);
        }
        return response;
    }

    /**
     * @description
     * Performs a query or mutation and returns the resulting status code.
     */
    async queryStatus<T = any, V extends Record<string, any> = Record<string, any>>(
        query: DocumentNode,
        variables?: V,
    ): Promise<number> {
        const response = await this.makeGraphQlRequest(query, variables);
        return response.status;
    }

    /**
     * @description
     * Attempts to log in with the specified credentials.
     */
    async asUserWithCredentials(username: string, password: string) {
        // first log out as the current user
        if (this.authToken) {
            await this.query(gql`
                mutation {
                    logout {
                        success
                    }
                }
            `);
        }
        const result = await this.query(LOGIN, { username, password });
        if (result.login.channels?.length === 1) {
            this.setChannelToken(result.login.channels[0].token);
        }
        return result.login;
    }

    /**
     * @description
     * Logs in as the SuperAdmin user.
     */
    async asSuperAdmin() {
        const { superadminCredentials } = this.vendureConfig.authOptions;
        await this.asUserWithCredentials(
            superadminCredentials?.identifier ?? SUPER_ADMIN_USER_IDENTIFIER,
            superadminCredentials?.password ?? SUPER_ADMIN_USER_PASSWORD,
        );
    }

    /**
     * @description
     * Logs out so that the client is then treated as an anonymous user.
     */
    async asAnonymousUser() {
        await this.query(gql`
            mutation {
                logout {
                    success
                }
            }
        `);
    }

    private async makeGraphQlRequest(
        query: DocumentNode,
        variables?: { [key: string]: any },
        queryParams?: QueryParams,
    ): Promise<Response> {
        const queryString = print(query);
        const body = JSON.stringify({
            query: queryString,
            variables: variables ? variables : undefined,
        });

        const url = queryParams ? this.apiUrl + `?${stringify(queryParams)}` : this.apiUrl;

        return this.fetch(url, {
            method: 'POST',
            body,
        });
    }

    private async getResult(response: Response): Promise<any> {
        const contentType = response.headers.get('Content-Type');
        if (contentType && contentType.startsWith('application/json')) {
            return response.json();
        } else {
            return response.text();
        }
    }

    /**
     * @description
     * Perform a file upload mutation.
     *
     * Upload spec: https://github.com/jaydenseric/graphql-multipart-request-spec
     *
     * Discussion of issue: https://github.com/jaydenseric/apollo-upload-client/issues/32
     *
     * @param mutation - GraphQL document for a mutation that has input files
     * with the Upload type.
     * @param filePaths - Array of paths to files, in the same order that the
     * corresponding Upload fields appear in the variables for the mutation.
     * @param mapVariables - Function that must return the variables for the
     * mutation, with `null` as the value for each `Upload` field.
     *
     * @example
     * ```ts
     * // Testing a custom mutation:
     * const result = await client.fileUploadMutation({
     *   mutation: gql`
     *     mutation AddSellerImages($input: AddSellerImagesInput!) {
     *       addSellerImages(input: $input) {
     *         id
     *         name
     *       }
     *     }
     *   `,
     *   filePaths: ['./images/profile-picture.jpg', './images/logo.png'],
     *   mapVariables: () => ({
     *     name: "George's Pans",
     *     profilePicture: null,  // corresponds to filePaths[0]
     *     branding: {
     *       logo: null  // corresponds to filePaths[1]
     *     }
     *   })
     * });
     * ```
     */
    async fileUploadMutation(options: {
        mutation: DocumentNode;
        filePaths: string[];
        mapVariables: (filePaths: string[]) => any;
    }): Promise<any> {
        const { mutation, filePaths, mapVariables } = options;

        const postData = createUploadPostData(mutation, filePaths, mapVariables);
        const body = new FormData();
        body.append('operations', JSON.stringify(postData.operations));
        body.append(
            'map',
            '{' +
                Object.entries(postData.map)
                    .map(([i, path]) => `"${i}":["${path}"]`)
                    .join(',') +
                '}',
        );
        for (const filePath of postData.filePaths) {
            const file = fs.readFileSync(filePath.file);
            body.append(filePath.name, file, { filename: filePath.file });
        }

        const result = await fetch(this.apiUrl, {
            method: 'POST',
            body,
            headers: {
                ...this.headers,
            },
        });
        const response = await result.json();
        if (response.errors && response.errors.length) {
            const error = response.errors[0];
            throw new Error(error.message);
        }
        return response.data;
    }
}

export class ClientError extends Error {
    constructor(
        public response: any,
        public request: any,
    ) {
        super(ClientError.extractMessage(response));
    }
    private static extractMessage(response: any): string {
        if (response.errors) {
            return response.errors[0].message;
        } else {
            return `GraphQL Error (Code: ${response.status as number})`;
        }
    }
}
