import { LanguageCode } from '@vendure/common/lib/generated-types';
import { fail } from 'assert';
import { describe, expect, it } from 'vitest';

import { Injector } from '../../common/injector';

import { RequestContext } from './request-context';
import { validateCustomFieldValue } from './validate-custom-field-value';

describe('validateCustomFieldValue()', () => {
    const injector = new Injector({} as any);

    async function assertThrowsError(validateFn: (() => Promise<void>) | (() => void), message: string) {
        try {
            await validateFn();
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toBe(message);
        }
    }

    const ctx = RequestContext.empty();

    describe('string & localeString', () => {
        const validate = (value: string | null) => () =>
            validateCustomFieldValue(
                {
                    name: 'test',
                    type: 'string',
                    pattern: '^[0-9]+',
                },
                value,
                injector,
                ctx,
            );

        it('passes valid pattern', async () => {
            expect(validate('1')).not.toThrow();
            expect(validate('123')).not.toThrow();
            expect(validate('1foo')).not.toThrow();
        });

        it('throws on invalid pattern', async () => {
            await assertThrowsError(validate(''), 'error.field-invalid-string-pattern');
            await assertThrowsError(validate('foo'), 'error.field-invalid-string-pattern');
            await assertThrowsError(validate(' 1foo'), 'error.field-invalid-string-pattern');
        });

        it('allows null for nullable field with pattern', async () => {
            expect(validate(null)).not.toThrow();
        });
    });

    describe('string options', () => {
        const validate = (value: string | null) => () =>
            validateCustomFieldValue(
                {
                    name: 'test',
                    type: 'string',
                    options: [{ value: 'small' }, { value: 'large' }],
                },
                value,
                injector,
                ctx,
            );

        it('passes valid option', async () => {
            expect(validate('small')).not.toThrow();
            expect(validate('large')).not.toThrow();
        });

        it('throws on invalid option', async () => {
            await assertThrowsError(validate('SMALL'), 'error.field-invalid-string-option');
            await assertThrowsError(validate(''), 'error.field-invalid-string-option');
            await assertThrowsError(validate('bad'), 'error.field-invalid-string-option');
        });

        it('allows null for a nullable field', () => {
            expect(validate(null)).not.toThrow();
        });

        it('throws on null for non-nullable field', async () => {
            await assertThrowsError(
                () =>
                    validateCustomFieldValue(
                        {
                            name: 'test',
                            type: 'string',
                            nullable: false,
                            options: [{ value: 'small' }, { value: 'large' }],
                        },
                        null,
                        injector,
                        ctx,
                    ),
                'error.field-invalid-non-nullable',
            );
        });
    });

    describe('int & float', () => {
        const validate = (value: number | null) => () =>
            validateCustomFieldValue(
                {
                    name: 'test',
                    type: 'int',
                    min: 5,
                    max: 10,
                },
                value,
                injector,
                ctx,
            );

        it('passes valid range', async () => {
            expect(validate(5)).not.toThrow();
            expect(validate(7)).not.toThrow();
            expect(validate(10)).not.toThrow();
        });

        it('throws on invalid range', async () => {
            await assertThrowsError(validate(4), 'error.field-invalid-number-range-min');
            await assertThrowsError(validate(11), 'error.field-invalid-number-range-max');
            await assertThrowsError(validate(-7), 'error.field-invalid-number-range-min');
        });

        it('allows null for nullable field', async () => {
            expect(validate(null)).not.toThrow();
        });
    });

    describe('datetime', () => {
        const validate = (value: string | null) => () =>
            validateCustomFieldValue(
                {
                    name: 'test',
                    type: 'datetime',
                    min: '2019-01-01T08:30',
                    max: '2019-06-01T08:30',
                },
                value,
                injector,
                ctx,
            );

        it('passes valid range', async () => {
            expect(validate('2019-01-01T08:30:00.000')).not.toThrow();
            expect(validate('2019-06-01T08:30:00.000')).not.toThrow();
            expect(validate('2019-04-12T14:15:51.200')).not.toThrow();
        });

        it('throws on invalid range', async () => {
            await assertThrowsError(
                validate('2019-01-01T08:29:00.000'),
                'error.field-invalid-datetime-range-min',
            );
            await assertThrowsError(
                validate('2019-06-01T08:30:00.100'),
                'error.field-invalid-datetime-range-max',
            );
        });

        it('allows null for nullable field', async () => {
            expect(validate(null)).not.toThrow();
        });
    });

    describe('validate function', () => {
        const validate1 = (value: string) => () =>
            validateCustomFieldValue(
                {
                    name: 'test',
                    type: 'string',
                    validate: (v: string) => {
                        if (v !== 'valid') {
                            return 'invalid';
                        }
                    },
                },
                value,
                injector,
                ctx,
            );
        const validate2 = (value: string, languageCode: LanguageCode) => () => {
            const ctxWithLanguage = new RequestContext({
                languageCode,
                apiType: 'admin',
            } as any);
            return validateCustomFieldValue(
                {
                    name: 'test',
                    type: 'string',
                    validate: (v: string) => {
                        if (v !== 'valid') {
                            return [
                                { languageCode: LanguageCode.en, value: 'invalid' },
                                { languageCode: LanguageCode.de, value: 'ungültig' },
                            ];
                        }
                    },
                },
                value,
                injector,
                ctxWithLanguage,
            );
        };

        it('passes validate fn string', async () => {
            expect(validate1('valid')).not.toThrow();
        });

        it('passes validate fn localized string', async () => {
            expect(validate2('valid', LanguageCode.de)).not.toThrow();
        });

        it('fails validate fn string', async () => {
            await assertThrowsError(validate1('bad'), 'invalid');
        });

        it('fails validate fn localized string en', async () => {
            await assertThrowsError(validate2('bad', LanguageCode.en), 'invalid');
        });

        it('fails validate fn localized string de', async () => {
            await assertThrowsError(validate2('bad', LanguageCode.de), 'ungültig');
        });
    });

    describe('list types', () => {
        it('number list', async () => {
            const validate = (value: number[]) => () =>
                validateCustomFieldValue(
                    {
                        name: 'test',
                        type: 'int',
                        list: true,
                        min: 0,
                        max: 10,
                    },
                    value,
                    injector,
                    ctx,
                );

            expect(validate([1, 2, 6])).not.toThrow();
            await assertThrowsError(validate([1, 15, 3]), 'error.field-invalid-number-range-max');
        });

        it('string list with options', async () => {
            const validate = (value: string[]) => () =>
                validateCustomFieldValue(
                    {
                        name: 'test',
                        list: true,
                        type: 'string',
                        options: [{ value: 'small' }, { value: 'large' }],
                    },
                    value,
                    injector,
                    ctx,
                );

            expect(validate(['small', 'large'])).not.toThrow();
            await assertThrowsError(validate(['small', 'huge']), 'error.field-invalid-string-option');
        });

        it('list with validate function', async () => {
            const validate = (value: string[]) => () =>
                validateCustomFieldValue(
                    {
                        name: 'test',
                        type: 'string',
                        list: true,
                        validate: (v: string[]) => {
                            if (!v.every(val => val === 'valid')) {
                                return 'invalid';
                            }
                        },
                    },
                    value,
                    injector,
                    ctx,
                );

            expect(validate(['valid', 'valid'])).not.toThrow();
            await assertThrowsError(validate(['bad input', 'valid']), 'invalid');
        });
    });
});
