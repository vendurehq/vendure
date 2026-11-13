import { defaultShippingCalculator, LanguageCode, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig, TEST_SETUP_TIMEOUT_MS } from '../../../e2e-common/test-config';
import * as DE_CATALOG from '../src/i18n/messages/de.json';
import * as JA from '../src/i18n/messages/ja.json';

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
            // Option labels keep every language, because the Admin UI picks the matching one
            // itself rather than being sent a single resolved string.
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

        it("resolves a core operation against core's own shipped catalog", async () => {
            // Japanese exists only in the catalog, so a key path which does not match the
            // operation resolves to English instead of failing, and would go unnoticed.
            const { shippingCalculators } = await adminClient.query(
                gql(SHIPPING_CALCULATORS),
                {},
                { languageCode: LanguageCode.ja },
            );
            const calculator = shippingCalculators.find(
                (c: any) => c.code === defaultShippingCalculator.code,
            );
            const ja = JA.configurableOperation.ShippingCalculator['default-shipping-calculator'];

            expect(calculator.description).toBe(ja.description);
            expect(calculator.args.find((a: any) => a.name === 'rate').label).toBe(ja.args.rate.label);
            expect(calculator.args.find((a: any) => a.name === 'includesTax').ui.options).toContainEqual(
                expect.objectContaining({
                    value: 'auto',
                    label: expect.arrayContaining([
                        { languageCode: LanguageCode.ja, value: ja.args.includesTax.options.auto.label },
                    ]),
                }),
            );
        });

        describe('Accept-Language', () => {
            afterEach(() => {
                adminClient.setHeader('Accept-Language', null);
            });

            async function getDefaultCalculator(languageCode: LanguageCode) {
                const { shippingCalculators } = await adminClient.query(
                    gql(SHIPPING_CALCULATORS),
                    {},
                    { languageCode },
                );
                return shippingCalculators.find((c: any) => c.code === defaultShippingCalculator.code);
            }

            it('resolves against the header rather than the content language', async () => {
                // An administrator reading the Admin UI in Japanese while editing the German
                // translation of their catalog should still read Japanese here.
                adminClient.setHeader('Accept-Language', 'ja');
                const calculator = await getDefaultCalculator(LanguageCode.de);
                const ja = JA.configurableOperation.ShippingCalculator['default-shipping-calculator'];

                expect(calculator.description).toBe(ja.description);
                expect(calculator.args.find((a: any) => a.name === 'rate').label).toBe(ja.args.rate.label);
            });

            it('merges an option label under the language the header asked for', async () => {
                adminClient.setHeader('Accept-Language', 'ja');
                const calculator = await getDefaultCalculator(LanguageCode.de);
                const ja = JA.configurableOperation.ShippingCalculator['default-shipping-calculator'];

                expect(calculator.args.find((a: any) => a.name === 'includesTax').ui.options).toContainEqual(
                    expect.objectContaining({
                        value: 'auto',
                        label: expect.arrayContaining([
                            {
                                languageCode: LanguageCode.ja,
                                value: ja.args.includesTax.options.auto.label,
                            },
                        ]),
                    }),
                );
            });

            it('honours the quality order of a multi-language header', async () => {
                // Both languages ship a catalog and the preferred one comes second, so a parser
                // which ignored the weights would resolve to German and fail here.
                adminClient.setHeader('Accept-Language', 'de;q=0.8, ja;q=0.9');
                const calculator = await getDefaultCalculator(LanguageCode.en);

                expect(calculator.description).toBe(
                    JA.configurableOperation.ShippingCalculator['default-shipping-calculator'].description,
                );
                expect(calculator.description).not.toBe(
                    DE_CATALOG.configurableOperation.ShippingCalculator['default-shipping-calculator']
                        .description,
                );
            });

            it('falls back to the content language when the header names nothing we have', async () => {
                // `xx` is a well-formed tag, so it survives parsing and is only exhausted at the
                // catalog lookup — which is the fallback this covers.
                adminClient.setHeader('Accept-Language', 'xx');
                const calculator = await getDefaultCalculator(LanguageCode.ja);

                expect(calculator.description).toBe(
                    JA.configurableOperation.ShippingCalculator['default-shipping-calculator'].description,
                );
            });
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
