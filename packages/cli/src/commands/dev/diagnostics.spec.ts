import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseDiagnostics } from './diagnostics.js';

// Real output, captured from tsc 5.8, ts-node 10 and @swc/core 1.15 and with the paths replaced.
const fixture = (name: string) =>
    readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', name), 'utf-8');

const typeErrors = [
    {
        file: 'src/index.ts',
        line: 1,
        column: 7,
        code: 'TS2322',
        message: "Type 'string' is not assignable to type 'number'.",
    },
    {
        file: 'src/index.ts',
        line: 3,
        column: 12,
        code: 'TS2339',
        message: "Property 'nope' does not exist on type 'string'.",
    },
];

describe('parseDiagnostics()', () => {
    it('reads tsc --pretty false output', () => {
        expect(parseDiagnostics(fixture('tsc.txt'))).toEqual(typeErrors);
    });

    it('reads the TSError that ts-node prints when the server fails to compile', () => {
        expect(parseDiagnostics(fixture('ts-node.txt'))).toEqual(typeErrors);
    });

    it('reads the coloured output of ts-node with pretty on', () => {
        expect(fixture('ts-node-pretty.txt')).toContain('\u001b[');
        expect(parseDiagnostics(fixture('ts-node-pretty.txt'))).toEqual(typeErrors);
    });

    it('reads an SWC error block, with the line of the marker rather than of the frame', () => {
        expect(parseDiagnostics(fixture('swc.txt'), '/home/dev/shop')).toEqual([
            { file: 'src/later.ts', line: 5, column: 15, message: 'Expression expected' },
        ]);
    });

    it('reads an SWC error block drawn in its graphical mode', () => {
        const output = [
            '  × Expected a semicolon',
            '   ╭─[/home/dev/shop/src/a.ts:1:1]',
            ' 1 │ export const a = 1;',
            ' 2 │ a b',
            '   ·   ─',
            '   ╰────',
        ].join('\n');
        expect(parseDiagnostics(output, '/home/dev/shop')).toEqual([
            { file: 'src/a.ts', line: 2, column: 3, message: 'Expected a semicolon' },
        ]);
    });

    it('returns no diagnostics for a crash that is not a compile error', () => {
        expect(parseDiagnostics('Error: listen EADDRINUSE: address already in use :::3000')).toEqual([]);
    });

    it('reports each diagnostic once', () => {
        const output = `${fixture('tsc.txt')}\n${fixture('tsc.txt')}`;
        expect(parseDiagnostics(output)).toHaveLength(2);
    });
});
