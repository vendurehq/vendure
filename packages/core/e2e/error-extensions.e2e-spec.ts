import { LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment } from '@vendure/testing';
import { spawnSync } from 'child_process';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

type ResponseError = { message: string; extensions?: Record<string, any> };

async function getErrors(request: Promise<unknown>): Promise<ResponseError[]> {
    try {
        await request;
    } catch (e: any) {
        return e.response.errors;
    }
    throw new Error('Expected the request to fail');
}

describe('GraphQL error extensions', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());

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

        expect(Object.keys(error.extensions ?? {}).sort()).toEqual(['code', 'vendureCode']);
    });
});

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
