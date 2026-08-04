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
    shippingCalculatorTranslations,
    TRANSLATED_SHIPPING_CALCULATOR_CODE,
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

    // https://github.com/vendurehq/vendure/issues/4820
    describe('configurable operation translations', () => {
        const de = shippingCalculatorTranslations.de;

        async function getCalculator(languageCode?: LanguageCode) {
            const { shippingCalculators } = await adminClient.query(
                gql(SHIPPING_CALCULATORS),
                {},
                languageCode ? { languageCode } : undefined,
            );
            return shippingCalculators.find((c: any) => c.code === TRANSLATED_SHIPPING_CALCULATOR_CODE);
        }

        it('resolves the inline English strings by default', async () => {
            const calculator = await getCalculator();
            expect(calculator.description).toBe('Translated shipping calculator');
            expect(calculator.args[0].label).toBe('Mode');
            expect(calculator.args[0].ui.options[0].label).toEqual([
                { languageCode: LanguageCode.en, value: 'Automatic' },
            ]);
        });

        it('resolves the catalog strings for the requested language', async () => {
            const calculator = await getCalculator(LanguageCode.de);
            expect(calculator.description).toBe(de.description);
            expect(calculator.args[0].label).toBe(de.modeLabel);
            // Option labels keep every language, because the Admin UI resolves them against the
            // display language rather than the content language sent with this request.
            expect(calculator.args[0].ui.options[0].label).toEqual([
                { languageCode: LanguageCode.en, value: 'Automatic' },
                { languageCode: LanguageCode.de, value: de.autoOptionLabel },
            ]);
        });

        it('does not carry a resolved language over into the next request', async () => {
            // The `ui` config is part of the long-lived shipping calculator instance, so resolving
            // option labels in place would leave every later request stuck on German.
            await getCalculator(LanguageCode.de);
            const calculator = await getCalculator(LanguageCode.en);

            expect(calculator.description).toBe('Translated shipping calculator');
            expect(calculator.args[0].ui.options[0].label).toEqual([
                { languageCode: LanguageCode.en, value: 'Automatic' },
            ]);
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

const SHIPPING_CALCULATORS = `
    query ShippingCalculators {
        shippingCalculators {
            code
            description
            args {
                name
                label
                ui
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
