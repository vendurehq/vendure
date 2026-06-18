import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { omit } from './omit';

declare const File: any;

describe('omit()', () => {
    let patchedFileClass = false;
    beforeAll(() => {
        // In Node.js there is no File constructor, so we need to patch
        // a mock version.
        if (typeof File === 'undefined') {
            (global as any).File = class MockFile {};
            patchedFileClass = true;
        }
    });

    afterAll(() => {
        if (patchedFileClass) {
            delete (global as any).File;
        }
    });

    it('returns a new object', () => {
        const obj = { foo: 1, bar: 2 };
        expect(omit(obj, ['bar'])).not.toBe(obj);
    });

    it('works with 1-level-deep objects', () => {
        expect(omit({ foo: 1, bar: 2 }, ['bar'])).toEqual({ foo: 1 });
        expect(omit({ foo: 1, bar: 2 }, ['bar', 'foo'])).toEqual({});
    });

    it('works with deeply-nested objects', () => {
        expect(
            omit(
                {
                    name: {
                        first: 'joe',
                        last: 'smith',
                    },
                    address: {
                        number: 12,
                    },
                },
                ['address'],
            ),
        ).toEqual({
            name: {
                first: 'joe',
                last: 'smith',
            },
        });
    });

    describe('recursive', () => {
        it('returns a new object', () => {
            const obj = { foo: 1, bar: 2 };
            expect(omit(obj, ['bar'], true)).not.toBe(obj);
        });

        it('works with 1-level-deep objects', () => {
            const input = {
                foo: 1,
                bar: 2,
                baz: 3,
            };
            const expected = { foo: 1, baz: 3 };

            expect(omit(input, ['bar'], true)).toEqual(expected);
        });

        it('works with 2-level-deep objects', () => {
            const input = {
                foo: 1,
                bar: {
                    bad: true,
                    good: true,
                },
                baz: {
                    bad: true,
                },
            };
            const expected = {
                foo: 1,
                bar: {
                    good: true,
                },
                baz: {},
            };

            expect(omit(input, ['bad'], true)).toEqual(expected);
        });

        it('works with array of objects', () => {
            const input = {
                foo: 1,
                bar: [
                    {
                        bad: true,
                        good: true,
                    },
                    { bad: true },
                ],
            };
            const expected = {
                foo: 1,
                bar: [{ good: true }, {}],
            };

            expect(omit(input, ['bad'], true)).toEqual(expected);
        });

        it('works top-level array', () => {
            const input = [{ foo: 1 }, { bad: true }, { bar: 2 }];
            const expected = [{ foo: 1 }, {}, { bar: 2 }];

            expect(omit(input, ['bad'], true)).toEqual(expected);
        });

        it('preserves File objects', () => {
            const file = new File([], 'foo');
            const input = [{ foo: 1 }, { bad: true }, { bar: file }];
            const expected = [{ foo: 1 }, {}, { bar: file }];

            expect(omit(input, ['bad'], true)).toEqual(expected);
        });
    });
});
