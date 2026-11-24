import { LanguageCode } from '@vendure/common/lib/generated-types';
import { INCLUDE_STACK_IN_ERRORS_ENV_VAR } from '@vendure/common/lib/shared-constants';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { spawnSync } from 'child_process';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

type ResponseError = { message: string; extensions?: Record<string, any> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Posts a raw request to the Shop API, so that the test can read the response headers.
 */
async function postToShopApi(
    config: ReturnType<typeof testConfig>,
    body: string,
    headers: Record<string, string> = {},
) {
    const url = `http://localhost:${config.apiOptions.port}/${config.apiOptions.shopApiPath ?? 'shop-api'}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
    });
    const json = (await response.json()) as { errors: ResponseError[] };
    return { headerId: response.headers.get('x-request-id'), error: json.errors[0] };
}

async function getErrors(request: Promise<unknown>): Promise<ResponseError[]> {
    try {
        await request;
    } catch (e: any) {
        return e.response.errors;
    }
    throw new Error('Expected the request to fail');
}

describe('GraphQL error extensions', () => {
    const config = testConfig();
    const { server, adminClient, shopClient } = createTestEnvironment(config);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 0,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('adds the vendureCode of an I18nError and keeps the coarse code', async () => {
        const [error] = await getErrors(adminClient.query(GET_ADMINISTRATORS));

        expect(error.message).toBe('You are not currently authorized to perform this action');
        expect(error.extensions?.code).toBe('FORBIDDEN');
        expect(error.extensions?.vendureCode).toBe('core.forbidden');
    });

    it('keeps the vendureCode when the message is translated', async () => {
        const [error] = await getErrors(
            adminClient.query(GET_ADMINISTRATORS, {}, { languageCode: LanguageCode.de }),
        );

        expect(error.message).toBe('Du bist momentan nicht autorisiert diese Aktion durchzuführen');
        expect(error.extensions?.vendureCode).toBe('core.forbidden');
    });

    it('adds the code built from the error key', async () => {
        await adminClient.asSuperAdmin();
        const [error] = await getErrors(adminClient.query(UPDATE_PRODUCT, { id: 'T_999' }));

        expect(error.extensions?.code).toBe('ENTITY_NOT_FOUND');
        expect(error.extensions?.vendureCode).toBe('core.entity-with-id-not-found');
    });

    it('gives an error which is not an I18nError the unexpected code', async () => {
        const [error] = await getErrors(shopClient.query(INVALID_QUERY));

        expect(error.extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
        expect(error.extensions?.vendureCode).toBe('core.unexpected');
    });

    it('adds no stack by default', async () => {
        await adminClient.asAnonymousUser();
        const [error] = await getErrors(adminClient.query(GET_ADMINISTRATORS));

        expect(process.env.NODE_ENV).not.toBe('production');
        expect(error.extensions).not.toHaveProperty('stack');
    });

    it('does not send the Apollo stacktrace or the translation variables', async () => {
        await adminClient.asSuperAdmin();
        const [error] = await getErrors(adminClient.query(UPDATE_PRODUCT, { id: 'T_999' }));

        expect(Object.keys(error.extensions ?? {}).sort()).toEqual(['code', 'requestId', 'vendureCode']);
    });
    describe('requestId', () => {
        const ME_QUERY = JSON.stringify({ query: '{ me { id } }' });

        it('is the ID in the x-request-id response header', async () => {
            const { headerId, error } = await postToShopApi(config, ME_QUERY);

            expect(error.extensions?.vendureCode).toBe('core.forbidden');
            expect(headerId).toMatch(UUID);
            expect(error.extensions?.requestId).toBe(headerId);
        });

        it('is the inbound x-request-id, which the response echoes back', async () => {
            const { headerId, error } = await postToShopApi(config, ME_QUERY, {
                'x-request-id': 'e2e-error-extensions-1',
            });

            expect(headerId).toBe('e2e-error-extensions-1');
            expect(error.extensions?.requestId).toBe('e2e-error-extensions-1');
        });

        it('is the generated ID which replaces an unsafe inbound ID', async () => {
            const { headerId, error } = await postToShopApi(config, ME_QUERY, {
                'x-request-id': 'not safe!',
            });

            expect(headerId).toMatch(UUID);
            expect(error.extensions?.requestId).toBe(headerId);
        });

        it('is on an error raised before execution', async () => {
            const { headerId, error } = await postToShopApi(
                config,
                JSON.stringify({ query: '{ notAField }' }),
            );

            expect(error.extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
            expect(error.extensions?.requestId).toBe(headerId);
        });

        it('is on a request which Apollo Server rejects', async () => {
            const { headerId, error } = await postToShopApi(config, '');

            expect(error.extensions?.code).toBe('BAD_REQUEST');
            expect(error.extensions?.requestId).toBe(headerId);
        });
    });
});

describe('apiOptions.includeStackInErrors: true', () => {
    const { server, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), { apiOptions: { includeStackInErrors: true } }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 0,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it("adds the project's stack frames to a resolver error, with relative paths", async () => {
        const [error] = await getErrors(shopClient.query(GET_ME));
        const stack: string[] = error.extensions?.stack ?? [];

        expect(error.extensions?.code).toBe('FORBIDDEN');
        expect(stack.length).toBeGreaterThan(0);
        for (const frame of stack) {
            expect(frame).toMatch(/^at /);
            expect(frame).not.toContain('node_modules');
            expect(frame).not.toContain(process.cwd());
        }
        expect(error.extensions?.stacktrace).toBeUndefined();
    });
});

/**
 * The variable is read when the GraphQL options are built, so it is set before `server.init()`.
 */
function describeWithStackVariable(
    title: string,
    includeStackInErrors: boolean | undefined,
    expectStack: boolean,
) {
    describe(title, () => {
        const { server, shopClient } = createTestEnvironment(
            mergeConfig(testConfig(), { apiOptions: { includeStackInErrors } }),
        );

        beforeAll(async () => {
            process.env[INCLUDE_STACK_IN_ERRORS_ENV_VAR] = 'true';
            await server.init({
                initialData,
                productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
                customerCount: 0,
            });
        }, TEST_SETUP_TIMEOUT_MS);

        afterAll(async () => {
            delete process.env[INCLUDE_STACK_IN_ERRORS_ENV_VAR];
            await server.destroy();
        });

        it(expectStack ? 'adds the stack frames' : 'adds no stack', async () => {
            const [error] = await getErrors(shopClient.query(GET_ME));

            if (expectStack) {
                expect(error.extensions?.stack?.length).toBeGreaterThan(0);
            } else {
                expect(error.extensions?.stack).toBeUndefined();
            }
        });
    });
}

describeWithStackVariable('VENDURE_INCLUDE_STACK_IN_ERRORS=true, option not set', undefined, true);
describeWithStackVariable('VENDURE_INCLUDE_STACK_IN_ERRORS=true, option false', false, false);

describe('startup errors', () => {
    /**
     * Runs `bootstrap()` with a config that fails validation in a child process, which exits as soon as
     * bootstrap rejects. The event line must already be on stderr by then.
     */
    it('writes one startup-error event line to stderr before the process exits', () => {
        const script = `
            const { bootstrap } = require('@vendure/core');
            bootstrap({
                dbConnectionOptions: { type: 'sqljs', synchronize: false },
                customFields: { Product: [{ name: 'not a valid name', type: 'string' }] },
            }).catch(() => process.exit(1));
        `;
        const result = spawnSync(process.execPath, ['-e', script], {
            cwd: __dirname,
            encoding: 'utf8',
            env: { ...process.env, VENDURE_DISABLE_TELEMETRY: 'true' },
            timeout: 60_000,
        });
        const events = result.stderr
            .split('\n')
            .filter(line => line.startsWith('{"vendure":"event"'))
            .map(line => JSON.parse(line));

        expect(result.status).toBe(1);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            vendure: 'event',
            event: 'startup-error',
            code: 'core.config.invalid-custom-fields',
        });
        expect(events[0].message).toContain('CustomFields config error');
        expect(events[0].fix).toEqual([{ description: expect.any(String) }]);
    });
});

const GET_ADMINISTRATORS = gql`
    query GetAdministrators {
        administrators {
            totalItems
        }
    }
`;

const GET_ME = gql`
    query GetMe {
        me {
            id
        }
    }
`;

const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($id: ID!) {
        updateProduct(input: { id: $id }) {
            id
        }
    }
`;

const INVALID_QUERY = gql`
    query {
        notAField
    }
`;
