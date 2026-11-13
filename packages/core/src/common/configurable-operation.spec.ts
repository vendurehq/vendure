import { LanguageCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { RequestContext } from '../api/common/request-context';

import {
    ConfigurableOperationDef,
    ConfigurableOperationTranslator,
    LocalizedStringArray,
} from './configurable-operation';
import { Injector } from './injector';

/**
 * A stand-in for the `configurableOperation` namespace of the message catalogs, keyed by language.
 * The real lookup against i18next is covered in `i18n.service.spec.ts`.
 */
function stubTranslator(catalogs: { [languageCode: string]: any }): ConfigurableOperationTranslator {
    return {
        getConfigurableOperationTranslation(languageCode, keyPath) {
            let node = catalogs[languageCode];
            for (const segment of keyPath) {
                if (node == null || typeof node !== 'object') {
                    return undefined;
                }
                node = node[segment];
            }
            return typeof node === 'string' ? node : undefined;
        },
    };
}

function createOperation(
    options: {
        code?: string;
        description?: LocalizedStringArray;
        argLabel?: LocalizedStringArray;
        optionLabel?: LocalizedStringArray;
    },
    translator?: ConfigurableOperationTranslator,
) {
    const operation = new ConfigurableOperationDef({
        code: options.code ?? 'test-calculator',
        description: options.description ?? [],
        args: {
            rate: {
                type: 'string',
                label: options.argLabel,
                ui: {
                    component: 'select-form-input',
                    options: [{ value: 'auto', label: options.optionLabel }],
                },
            },
        },
    });
    operation.setDefType('ShippingCalculator');
    if (translator) {
        void operation.init({ get: () => translator } as unknown as Injector);
    }
    return operation;
}

function createRequestContext(
    languageCode: LanguageCode,
    channelLanguageCode = LanguageCode.en,
    acceptedLanguageCodes: LanguageCode[] = [],
) {
    return {
        languageCode,
        acceptedLanguageCodes,
        channel: { defaultLanguageCode: channelLanguageCode },
    } as unknown as RequestContext;
}

const inlineDescription: LocalizedStringArray = [
    { languageCode: LanguageCode.en, value: 'Inline English' },
    { languageCode: LanguageCode.de, value: 'Inline German' },
];

function catalogDescription(value: string) {
    return { ShippingCalculator: { 'test-calculator': { description: value } } };
}

describe('ConfigurableOperationDef', () => {
    describe('description resolution', () => {
        it('uses the catalog entry for the requested language', () => {
            const operation = createOperation(
                { description: inlineDescription },
                stubTranslator({ de: catalogDescription('Catalog German') }),
            );

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.de)).description).toBe(
                'Catalog German',
            );
        });

        it('prefers the catalog over the inline value for the same language', () => {
            const operation = createOperation(
                { description: inlineDescription },
                stubTranslator({ en: catalogDescription('Catalog English') }),
            );

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.en)).description).toBe(
                'Catalog English',
            );
        });

        it('uses the inline value when the catalog has no entry for the requested language', () => {
            // The critical case for existing plugins: the English catalog must not be reached
            // before the operation's own German string.
            const operation = createOperation(
                { description: inlineDescription },
                stubTranslator({ en: catalogDescription('Catalog English') }),
            );

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.de)).description).toBe(
                'Inline German',
            );
        });

        it('falls back to the channel default language', () => {
            const operation = createOperation(
                { description: inlineDescription },
                stubTranslator({ de: catalogDescription('Catalog German') }),
            );

            expect(
                operation.toGraphQlType(createRequestContext(LanguageCode.fr, LanguageCode.de)).description,
            ).toBe('Catalog German');
        });

        it('falls back to English', () => {
            const operation = createOperation({ description: inlineDescription }, stubTranslator({}));

            expect(
                operation.toGraphQlType(createRequestContext(LanguageCode.fr, LanguageCode.es)).description,
            ).toBe('Inline English');
        });

        it('falls back to the first inline entry when no language in the chain matches', () => {
            const operation = createOperation(
                { description: [{ languageCode: LanguageCode.zh, value: 'Inline Chinese' }] },
                stubTranslator({}),
            );

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.fr)).description).toBe(
                'Inline Chinese',
            );
        });

        it('returns an empty description rather than throwing when there is nothing to resolve', () => {
            const operation = createOperation({ description: [] }, stubTranslator({}));

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.fr)).description).toBe('');
        });

        it('resolves from the inline values when no translator has been injected', () => {
            const operation = createOperation({ description: inlineDescription });

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.de)).description).toBe(
                'Inline German',
            );
        });

        it('resolves a code containing dots', () => {
            const operation = createOperation(
                { code: 'acme.flat-rate', description: inlineDescription },
                stubTranslator({
                    de: { ShippingCalculator: { 'acme.flat-rate': { description: 'Catalog German' } } },
                }),
            );

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.de)).description).toBe(
                'Catalog German',
            );
        });
    });

    describe('arg label resolution', () => {
        it('uses the catalog entry', () => {
            const operation = createOperation(
                { argLabel: [{ languageCode: LanguageCode.en, value: 'Inline label' }] },
                stubTranslator({
                    de: {
                        ShippingCalculator: {
                            'test-calculator': { args: { rate: { label: 'Catalog label' } } },
                        },
                    },
                }),
            );

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.de)).args[0].label).toBe(
                'Catalog label',
            );
        });

        it('resolves a label defined only in the catalog', () => {
            const operation = createOperation(
                {},
                stubTranslator({
                    en: {
                        ShippingCalculator: {
                            'test-calculator': { args: { rate: { label: 'Catalog label' } } },
                        },
                    },
                }),
            );

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.en)).args[0].label).toBe(
                'Catalog label',
            );
        });

        it('leaves the label undefined when neither source defines it', () => {
            const operation = createOperation({}, stubTranslator({}));

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.en)).args[0].label).toBe(
                undefined,
            );
        });
    });

    describe('ui option label resolution', () => {
        const optionLabelCatalog = (value: string) => ({
            ShippingCalculator: {
                'test-calculator': { args: { rate: { options: { auto: { label: value } } } } },
            },
        });

        it('merges the catalog translation into the existing label array', () => {
            // The Admin UI resolves option labels against the display language, which is a separate
            // setting from the content language sent with the request, so the other languages have
            // to survive rather than being narrowed away.
            const operation = createOperation(
                { optionLabel: [{ languageCode: LanguageCode.en, value: 'Inline option' }] },
                stubTranslator({ de: optionLabelCatalog('Catalog option') }),
            );

            const ui = operation.toGraphQlType(createRequestContext(LanguageCode.de)).args[0].ui;
            expect(ui.options).toEqual([
                {
                    value: 'auto',
                    label: [
                        { languageCode: LanguageCode.en, value: 'Inline option' },
                        { languageCode: LanguageCode.de, value: 'Catalog option' },
                    ],
                },
            ]);
        });

        it('replaces rather than duplicates an inline label for the same language', () => {
            const operation = createOperation(
                {
                    optionLabel: [
                        { languageCode: LanguageCode.en, value: 'Inline English option' },
                        { languageCode: LanguageCode.de, value: 'Inline German option' },
                    ],
                },
                stubTranslator({ de: optionLabelCatalog('Catalog German option') }),
            );

            const ui = operation.toGraphQlType(createRequestContext(LanguageCode.de)).args[0].ui;
            expect(ui.options[0].label).toEqual([
                { languageCode: LanguageCode.en, value: 'Inline English option' },
                { languageCode: LanguageCode.de, value: 'Catalog German option' },
            ]);
        });

        it('passes the label through untouched when the catalog has no entry', () => {
            const inlineOptionLabel: LocalizedStringArray = [
                { languageCode: LanguageCode.en, value: 'Inline English option' },
                { languageCode: LanguageCode.de, value: 'Inline German option' },
            ];
            const operation = createOperation({ optionLabel: inlineOptionLabel }, stubTranslator({}));

            expect(
                operation.toGraphQlType(createRequestContext(LanguageCode.de)).args[0].ui.options[0].label,
            ).toEqual(inlineOptionLabel);
        });

        it('does not mutate the shared ui config, so requests do not affect each other', () => {
            const inlineOptionLabel: LocalizedStringArray = [
                { languageCode: LanguageCode.en, value: 'Inline English option' },
            ];
            const operation = createOperation(
                { optionLabel: inlineOptionLabel },
                stubTranslator({ de: optionLabelCatalog('Catalog German option') }),
            );

            operation.toGraphQlType(createRequestContext(LanguageCode.de));
            const second = operation.toGraphQlType(createRequestContext(LanguageCode.en));

            // The German entry merged in for the first request must not have leaked into the
            // shared config and reappeared here.
            expect(second.args[0].ui.options[0].label).toEqual([
                { languageCode: LanguageCode.en, value: 'Inline English option' },
            ]);
            expect(inlineOptionLabel).toHaveLength(1);
        });

        it('leaves a ui config with no options untouched', () => {
            const operation = new ConfigurableOperationDef({
                code: 'test-calculator',
                description: [],
                args: { rate: { type: 'string', ui: { component: 'currency-form-input' } } },
            });

            expect(operation.toGraphQlType(createRequestContext(LanguageCode.en)).args[0].ui).toEqual({
                component: 'currency-form-input',
            });
        });
    });

    describe('reader language', () => {
        // These strings describe the operation, so they follow the language the client asked to
        // read. The content language selects a translation of the data and has no bearing on them.
        it('prefers an accepted language over the content language', () => {
            const operation = createOperation(
                { description: inlineDescription },
                stubTranslator({
                    ja: catalogDescription('Catalog Japanese'),
                    de: catalogDescription('Catalog German'),
                }),
            );

            const ctx = createRequestContext(LanguageCode.de, LanguageCode.en, [LanguageCode.ja]);
            expect(operation.toGraphQlType(ctx).description).toBe('Catalog Japanese');
        });

        it('tries the accepted languages in order', () => {
            const operation = createOperation(
                { description: inlineDescription },
                stubTranslator({ fr: catalogDescription('Catalog French') }),
            );

            const ctx = createRequestContext(LanguageCode.en, LanguageCode.en, [
                LanguageCode.ja,
                LanguageCode.fr,
            ]);
            expect(operation.toGraphQlType(ctx).description).toBe('Catalog French');
        });

        it('falls back to the content language when no accepted language resolves', () => {
            const operation = createOperation(
                { description: inlineDescription },
                stubTranslator({ de: catalogDescription('Catalog German') }),
            );

            const ctx = createRequestContext(LanguageCode.de, LanguageCode.en, [LanguageCode.ja]);
            expect(operation.toGraphQlType(ctx).description).toBe('Catalog German');
        });

        it('resolves an arg label against the accepted language', () => {
            const operation = createOperation(
                { argLabel: [{ languageCode: LanguageCode.en, value: 'Inline label' }] },
                stubTranslator({
                    ja: {
                        ShippingCalculator: {
                            'test-calculator': { args: { rate: { label: 'Catalog Japanese label' } } },
                        },
                    },
                }),
            );

            const ctx = createRequestContext(LanguageCode.de, LanguageCode.en, [LanguageCode.ja]);
            expect(operation.toGraphQlType(ctx).args[0].label).toBe('Catalog Japanese label');
        });

        it('merges an option label under the accepted language, which is where the client looks', () => {
            const operation = createOperation(
                { optionLabel: [{ languageCode: LanguageCode.en, value: 'Inline option' }] },
                stubTranslator({
                    ja: {
                        ShippingCalculator: {
                            'test-calculator': {
                                args: { rate: { options: { auto: { label: 'Catalog Japanese option' } } } },
                            },
                        },
                    },
                }),
            );

            const ctx = createRequestContext(LanguageCode.de, LanguageCode.en, [LanguageCode.ja]);
            expect(operation.toGraphQlType(ctx).args[0].ui.options[0].label).toEqual([
                { languageCode: LanguageCode.en, value: 'Inline option' },
                { languageCode: LanguageCode.ja, value: 'Catalog Japanese option' },
            ]);
        });

        it('tags an option label found by truncation with the language that was asked for', () => {
            // The client looks up its own display language and falls back to the first entry when
            // it finds no exact match, so tagging this `pt` would leave the translation unused.
            const operation = createOperation(
                { optionLabel: [{ languageCode: LanguageCode.en, value: 'Inline option' }] },
                stubTranslator({
                    pt: {
                        ShippingCalculator: {
                            'test-calculator': {
                                args: { rate: { options: { auto: { label: 'Catalog Portuguese' } } } },
                            },
                        },
                    },
                }),
            );

            const ctx = createRequestContext(LanguageCode.en, LanguageCode.en, [
                LanguageCode.pt_BR,
                LanguageCode.pt,
            ]);
            expect(operation.toGraphQlType(ctx).args[0].ui.options[0].label).toEqual([
                { languageCode: LanguageCode.en, value: 'Inline option' },
                { languageCode: LanguageCode.pt_BR, value: 'Catalog Portuguese' },
            ]);
        });
    });

    describe('getTranslationKeys', () => {
        it('lists every translatable string with its English source value', () => {
            const operation = createOperation({
                description: inlineDescription,
                argLabel: [{ languageCode: LanguageCode.en, value: 'Rate' }],
                optionLabel: [{ languageCode: LanguageCode.en, value: 'Automatic' }],
            });

            expect(operation.getTranslationKeys()).toEqual([
                {
                    keyPath: ['ShippingCalculator', 'test-calculator', 'description'],
                    sourceValue: 'Inline English',
                },
                {
                    keyPath: ['ShippingCalculator', 'test-calculator', 'args', 'rate', 'label'],
                    sourceValue: 'Rate',
                },
                {
                    keyPath: ['ShippingCalculator', 'test-calculator', 'args', 'rate', 'description'],
                    sourceValue: undefined,
                },
                {
                    keyPath: [
                        'ShippingCalculator',
                        'test-calculator',
                        'args',
                        'rate',
                        'options',
                        'auto',
                        'label',
                    ],
                    sourceValue: 'Automatic',
                },
            ]);
        });

        it('contributes no option keys for an arg whose ui has no options', () => {
            const operation = new ConfigurableOperationDef({
                code: 'test-calculator',
                description: [],
                args: { rate: { type: 'string', ui: { component: 'currency-form-input' } } },
            });
            operation.setDefType('ShippingCalculator');

            expect(operation.getTranslationKeys().map(k => k.keyPath.join('.'))).toEqual([
                'ShippingCalculator.test-calculator.description',
                'ShippingCalculator.test-calculator.args.rate.label',
                'ShippingCalculator.test-calculator.args.rate.description',
            ]);
        });

        it('returns nothing for an operation with no defType', () => {
            const operation = new ConfigurableOperationDef({
                code: 'test',
                description: [],
                args: {},
            });

            expect(operation.getTranslationKeys()).toEqual([]);
        });
    });
});
