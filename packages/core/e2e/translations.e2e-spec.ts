import { LanguageCode, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig, TEST_SETUP_TIMEOUT_MS } from '../../../e2e-common/test-config';

import * as DE from './fixtures/i18n/de.json';
import * as EN from './fixtures/i18n/en.json';
import {
    CUSTOM_ERROR_MESSAGE_TRANSLATION,
    TranslationTestPlugin,
} from './fixtures/test-plugins/translation-test-plugin';

describe('Translation', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TranslationTestPlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('translations added manualy', () => {
        it('shall receive custom error message', async () => {
            const { customErrorMessage } = await adminClient.query(gql(CUSTOM_ERROR));
            expect(customErrorMessage.errorCode).toBe('CUSTOM_ERROR');
            expect(customErrorMessage.message).toBe(CUSTOM_ERROR_MESSAGE_TRANSLATION);
        });

        it('shall receive german error message', async () => {
            const { customErrorMessage } = await adminClient.query(
                gql(CUSTOM_ERROR),
                {},
                { languageCode: LanguageCode.de },
            );
            expect(customErrorMessage.errorCode).toBe('CUSTOM_ERROR');
            expect(customErrorMessage.message).toBe('DE_' + CUSTOM_ERROR_MESSAGE_TRANSLATION);
        });
    });

    describe('translation added by file', () => {
        it('shall receive custom error message', async () => {
            const { newErrorMessage } = await adminClient.query(gql(NEW_ERROR));
            expect(newErrorMessage.errorCode).toBe('NEW_ERROR');
            expect(newErrorMessage.message).toBe(EN.errorResult.NEW_ERROR);
        });

        it('shall receive german error message', async () => {
            const { newErrorMessage } = await adminClient.query(
                gql(NEW_ERROR),
                {},
                { languageCode: LanguageCode.de },
            );
            expect(newErrorMessage.errorCode).toBe('NEW_ERROR');
            expect(newErrorMessage.message).toBe(DE.errorResult.NEW_ERROR);
        });
    });

    // https://github.com/vendurehq/vendure/issues/4823
    describe('unsupported language codes', () => {
        it('falls back to English for arbitrary language codes', async () => {
            const { customErrorMessage } = await adminClient.query(
                gql(CUSTOM_ERROR),
                {},
                { languageCode: 'xx-unsupported' },
            );
            expect(customErrorMessage.message).toBe(CUSTOM_ERROR_MESSAGE_TRANSLATION);
        });
    });
});

const CUSTOM_ERROR = `
    query CustomError {
        customErrorMessage {
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const NEW_ERROR = `
    query NewError {
        newErrorMessage {
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;
