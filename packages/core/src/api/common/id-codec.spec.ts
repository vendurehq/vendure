import { beforeEach, describe, expect, it } from 'vitest';

import { DECODED, ENCODED, MockIdStrategy } from '../../config/config.service.mock';

import { IdCodec } from './id-codec';

describe('IdCodecService', () => {
    let idCodec: IdCodec;

    beforeEach(async () => {
        idCodec = new IdCodec(new MockIdStrategy());
    });

    describe('encode()', () => {
        it('works with a string', () => {
            const input = 'id';

            const result = idCodec.encode(input);
            expect(result).toEqual(ENCODED);
        });

        it('works with a number', () => {
            const input = 123;

            const result = idCodec.encode(input);
            expect(result).toEqual(ENCODED);
        });

        it('works with a boolean', () => {
            const input = true;

            const result = idCodec.encode(input);
            expect(result).toEqual(true);
        });

        it('passes through null or undefined without throwing', () => {
            expect(idCodec.encode(null as any)).toBeNull();
            expect(idCodec.encode(undefined as any)).toBeUndefined();
        });

        it('returns a clone of the input object', () => {
            const input = { id: 'id', name: 'foo' };

            const result = idCodec.encode(input);
            expect(result).not.toBe(input);
        });

        it('returns a deep clone', () => {
            const obj1 = { 1: true };
            const obj2 = { 2: true };
            const arr = [obj1, obj2];
            const parent = { myArray: arr };
            const input = { foo: parent };

            const result = idCodec.encode(input);
            expect(result).not.toBe(input);
            expect(result.foo).not.toBe(parent);
            expect(result.foo.myArray).not.toBe(arr);
            expect(result.foo.myArray[0]).not.toBe(obj1);
            expect(result.foo.myArray[1]).not.toBe(obj2);
        });

        it('does not clone complex object instances', () => {
            /* eslint-disable @typescript-eslint/no-floating-promises */
            const promise = new Promise(() => {
                /**/
            });
            const date = new Date();
            const regex = new RegExp('');
            const input = {
                promise,
                date,
                regex,
            };
            const result = idCodec.encode(input);
            expect(result.promise).toBe(promise);
            expect(result.date).toBe(date);
            expect(result.regex).toBe(regex);
            /* eslint-enable @typescript-eslint/no-floating-promises */
        });

        it('works with simple entity', () => {
            const input = { id: 'id', name: 'foo' };

            const result = idCodec.encode(input);
            expect(result).toEqual({ id: ENCODED, name: 'foo' });
        });

        it('works with 2-level nested entities', () => {
            const input = {
                id: 'id',
                friend: { id: 'id' },
            };

            const result = idCodec.encode(input);
            expect(result).toEqual({
                id: ENCODED,
                friend: { id: ENCODED },
            });
        });

        it('works with 3-level nested entities', () => {
            const input = {
                id: 'id',
                friend: {
                    dog: { id: 'id' },
                },
            };

            const result = idCodec.encode(input);
            expect(result).toEqual({
                id: ENCODED,
                friend: {
                    dog: { id: ENCODED },
                },
            });
        });

        it('works with list of simple entities', () => {
            const input = [
                { id: 'id', name: 'foo' },
                { id: 'id', name: 'bar' },
            ];

            const result = idCodec.encode(input);
            expect(result).toEqual([
                { id: ENCODED, name: 'foo' },
                { id: ENCODED, name: 'bar' },
            ]);
        });

        it('does not throw with an empty list', () => {
            const input: any[] = [];

            const result = idCodec.encode(input);
            expect(() => idCodec.encode(input)).not.toThrow();
        });

        it('works with nested list of simple entities', () => {
            const input = {
                items: [
                    { id: 'id', name: 'foo' },
                    { id: 'id', name: 'bar' },
                ],
            };

            const result = idCodec.encode(input);
            expect(result).toEqual({
                items: [
                    { id: ENCODED, name: 'foo' },
                    { id: ENCODED, name: 'bar' },
                ],
            });
        });

        it('works with large and nested list', () => {
            const length = 100;
            const input = {
                items: Array.from({ length }).map(() => ({
                    id: 'id',
                    name: { bar: 'baz' },
                    foo: 'yo',
                    friends: [{ id: 'id', name: { first: 'boris', id: 'id' } }],
                })),
            };

            const result = idCodec.encode(input);
            expect(result.items.length).toBe(length);
            expect(result.items[0].id).toBe(ENCODED);
            expect(result.items[0].friends[0].id).toBe(ENCODED);
            expect(result.items[0].friends[0].name.id).toBe(ENCODED);
        });

        it('works with lists with a nullable object property', () => {
            const input = {
                items: [{ user: null }, { user: { id: 'id' } }],
            };

            const result = idCodec.encode(input);
            expect(result.items[0].user).toBe(null);
            expect(result.items[1].user).toEqual({ id: ENCODED });
        });

        it('works with nested list of nested lists', () => {
            const input = {
                items: [
                    {
                        id: 'id',
                        friends: [{ id: 'id' }, { id: 'id' }],
                    },
                    {
                        id: 'id',
                        friends: [{ id: 'id' }, { id: 'id' }],
                    },
                ],
            };

            const result = idCodec.encode(input);
            expect(result).toEqual({
                items: [
                    {
                        id: ENCODED,
                        friends: [{ id: ENCODED }, { id: ENCODED }],
                    },
                    {
                        id: ENCODED,
                        friends: [{ id: ENCODED }, { id: ENCODED }],
                    },
                ],
            });
        });

        it('transformKeys can be customized', () => {
            const input = { id: 'id', name: 'foo' };

            const result = idCodec.encode(input, ['name']);
            expect(result).toEqual({ id: ENCODED, name: ENCODED });
        });
    });

    describe('decode()', () => {
        it('works with a string', () => {
            const input = 'id';

            const result = idCodec.decode(input);
            expect(result).toEqual(DECODED);
        });

        it('works with a number', () => {
            const input = 123;

            const result = idCodec.decode(input);
            expect(result).toEqual(DECODED);
        });

        it('works with simple entity', () => {
            const input = { id: 'id', name: 'foo' };

            const result = idCodec.decode(input);
            expect(result).toEqual({ id: DECODED, name: 'foo' });
        });

        it('works with 2-level nested entities', () => {
            const input = {
                id: 'id',
                friend: { id: 'id' },
            };

            const result = idCodec.decode(input);
            expect(result).toEqual({
                id: DECODED,
                friend: { id: DECODED },
            });
        });

        it('works with 3-level nested entities', () => {
            const input = {
                id: 'id',
                friend: {
                    dog: { id: 'id' },
                },
            };

            const result = idCodec.decode(input);
            expect(result).toEqual({
                id: DECODED,
                friend: {
                    dog: { id: DECODED },
                },
            });
        });

        it('works with list of simple entities', () => {
            const input = [
                { id: 'id', name: 'foo' },
                { id: 'id', name: 'bar' },
            ];

            const result = idCodec.decode(input);
            expect(result).toEqual([
                { id: DECODED, name: 'foo' },
                { id: DECODED, name: 'bar' },
            ]);
        });

        it('works with nested list of simple entities', () => {
            const input = {
                items: [
                    { id: 'id', name: 'foo' },
                    { id: 'id', name: 'bar' },
                ],
            };

            const result = idCodec.decode(input);
            expect(result).toEqual({
                items: [
                    { id: DECODED, name: 'foo' },
                    { id: DECODED, name: 'bar' },
                ],
            });
        });

        it('works with lists with a nullable object property', () => {
            const input = {
                items: [{ user: null }, { user: { id: 'id' } }],
            };

            const result = idCodec.decode(input);
            expect(result.items[0].user).toBe(null);
            expect(result.items[1].user).toEqual({ id: DECODED });
        });

        it('works with large and nested list', () => {
            const length = 100;
            const input = {
                items: Array.from({ length }).map(() => ({
                    id: 'id',
                    name: { bar: 'baz' },
                    foo: 'yo',
                    friends: [{ id: 'id', name: { first: 'boris', id: 'id' } }],
                })),
            };

            const result = idCodec.decode(input);
            expect(result.items.length).toBe(length);
            expect(result.items[0].id).toBe(DECODED);
            expect(result.items[0].friends[0].id).toBe(DECODED);
            expect(result.items[0].friends[0].name.id).toBe(DECODED);
        });

        it('works with nested list of nested lists', () => {
            const input = {
                items: [
                    {
                        id: 'id',
                        friends: [{ id: 'id' }, { id: 'id' }],
                    },
                    {
                        id: 'id',
                        friends: [{ id: 'id' }, { id: 'id' }],
                    },
                ],
            };

            const result = idCodec.decode(input);
            expect(result).toEqual({
                items: [
                    {
                        id: DECODED,
                        friends: [{ id: DECODED }, { id: DECODED }],
                    },
                    {
                        id: DECODED,
                        friends: [{ id: DECODED }, { id: DECODED }],
                    },
                ],
            });
        });

        it('transformKeys can be customized', () => {
            const input = { name: 'foo' };

            const result = idCodec.decode(input, ['name']);
            expect(result).toEqual({ name: DECODED });
        });

        it('id keys is still implicitly decoded when transformKeys are defined', () => {
            const input = { id: 'id', name: 'foo' };

            const result = idCodec.decode(input, ['name']);
            expect(result).toEqual({ id: DECODED, name: DECODED });
        });

        it('transformKeys works for nested matching keys', () => {
            const input = {
                input: {
                    id: 'id',
                    featuredAssetId: 'id',
                    foo: 'bar',
                },
            };

            const result = idCodec.decode(input, ['featuredAssetId']);
            expect(result).toEqual({
                input: {
                    id: DECODED,
                    featuredAssetId: DECODED,
                    foo: 'bar',
                },
            });
        });

        it('transformKeys works for nested matching key array', () => {
            const input = {
                input: {
                    id: 'id',
                    assetIds: ['id1', 'id2', 'id3'],
                    foo: 'bar',
                },
            };

            const result = idCodec.decode(input, ['assetIds']);
            expect(result).toEqual({
                input: {
                    id: DECODED,
                    assetIds: [DECODED, DECODED, DECODED],
                    foo: 'bar',
                },
            });
        });

        it('transformKeys works for multiple nested keys', () => {
            const input = {
                input: {
                    id: 'id',
                    featuredAssetId: 'id',
                    assetIds: ['id1', 'id2', 'id3'],
                    foo: 'bar',
                },
            };

            const result = idCodec.decode(input, ['featuredAssetId', 'assetIds']);
            expect(result).toEqual({
                input: {
                    id: DECODED,
                    featuredAssetId: DECODED,
                    assetIds: [DECODED, DECODED, DECODED],
                    foo: 'bar',
                },
            });
        });

        // https://github.com/vendurehq/vendure/issues/1596
        it('works with heterogeneous array', () => {
            const input1 = { value: [null, 'foo'] };
            const input2 = { value: [false, 'foo'] };
            const input3 = { value: [{}, 'foo'] };
            const input4 = { value: [[], 'foo'] };
            const input5 = { value: [0, 'foo'] };

            const result1 = idCodec.decode(input1);
            const result2 = idCodec.decode(input2);
            const result3 = idCodec.decode(input3);
            const result4 = idCodec.decode(input4);
            const result5 = idCodec.decode(input5);

            expect(result1).toEqual(input1);
            expect(result2).toEqual(input2);
            expect(result3).toEqual(input3);
            expect(result4).toEqual(input4);
            expect(result5).toEqual(input5);
        });
    });
});
