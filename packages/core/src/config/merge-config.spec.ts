import { describe, expect, it } from 'vitest';

import { mergeConfig } from './merge-config';

describe('mergeConfig()', () => {
    it('creates a new object reference', () => {
        const nestedObject = { b: 2 };
        const input: any = {
            a: nestedObject,
        };

        const result = mergeConfig(input, { c: 5 } as any);
        expect(result).toEqual({
            a: nestedObject,
            c: 5,
        });
        expect(input).not.toBe(result);
        expect(input.a).not.toBe(result.a);
    });
    it('merges top-level properties', () => {
        const input: any = {
            a: 1,
            b: 2,
        };

        const result = mergeConfig(input, { b: 3, c: 5 } as any);
        expect(result).toEqual({
            a: 1,
            b: 3,
            c: 5,
        });
    });

    it('does not merge arrays', () => {
        const input: any = {
            a: [1],
        };

        const result = mergeConfig(input, { a: [2] } as any);
        expect(result).toEqual({
            a: [2],
        });
    });

    it('merges deep properties', () => {
        const input: any = {
            a: 1,
            b: { c: 2 },
        };

        const result = mergeConfig(input, { b: { c: 5 } } as any);
        expect(result).toEqual({
            a: 1,
            b: { c: 5 },
        });
    });

    it('does not mutate target', () => {
        const input: any = {
            a: 1,
            b: { c: { d: 'foo', e: { f: 1 } } },
        };

        const result = mergeConfig(input, { b: { c: { d: 'bar' } } } as any);
        expect(result).toEqual({
            a: 1,
            b: { c: { d: 'bar', e: { f: 1 } } },
        });
        expect(input).toEqual({
            a: 1,
            b: { c: { d: 'foo', e: { f: 1 } } },
        });
    });

    it('works when nested', () => {
        const input1: any = {
            a: 1,
            b: { c: { d: 'foo1', e: { f: 1 } } },
        };

        const input2: any = {
            b: { c: { d: 'foo2', e: { f: 2 } } },
        };

        const result = mergeConfig(input1, mergeConfig(input2, { b: { c: { d: 'bar' } } } as any));

        expect(result).toEqual({
            a: 1,
            b: { c: { d: 'bar', e: { f: 2 } } },
        });
        expect(input1).toEqual({
            a: 1,
            b: { c: { d: 'foo1', e: { f: 1 } } },
        });
        expect(input2).toEqual({
            b: { c: { d: 'foo2', e: { f: 2 } } },
        });
    });

    it('replaces a boolean with an object', () => {
        const input: any = {
            apiOptions: { csrfPrevention: true, cors: false },
        };

        const result = mergeConfig(input, {
            apiOptions: {
                csrfPrevention: { requestHeaders: ['x-my-client-header'] },
                cors: { origin: ['https://example.com'], credentials: true },
            },
        });

        expect(result.apiOptions.csrfPrevention).toEqual({ requestHeaders: ['x-my-client-header'] });
        expect(result.apiOptions.cors).toEqual({ origin: ['https://example.com'], credentials: true });
    });

    it('replaces an array with an object', () => {
        const input: any = { a: [1, 2] };

        const result = mergeConfig(input, { a: { b: 1 } } as any);

        expect(result).toEqual({ a: { b: 1 } });
    });

    it('replaces class instances rather than merging their properties', () => {
        class Foo {
            name = 'foo';
        }

        class Bar {
            name = 'bar';
        }

        const input: any = {
            class: new Foo(),
        };

        const result = mergeConfig(input, { class: new Bar() } as any);

        expect(result.class instanceof Bar).toBe(true);
        expect(result.class.name).toBe('bar');
    });
});
