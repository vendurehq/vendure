import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { trimStack } from './trim-stack';

describe('trimStack()', () => {
    const cwd = path.resolve('/app');
    const file = (...segments: string[]) => path.join(cwd, ...segments);

    it('keeps the frames under cwd, with paths relative to it', () => {
        const stack = [
            'Error: error.forbidden',
            `    at OrderService.addItem (${file('src', 'order.service.ts')}:12:5)`,
            `    at ${file('src', 'index.ts')}:3:1`,
            `    at async Resolver.run (${file('node_modules', '@vendure', 'core', 'resolver.js')}:1:1)`,
            '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
            `    at Other.run (${path.resolve('/elsewhere', 'other.ts')}:1:1)`,
            '    at new Promise (<anonymous>)',
        ].join('\n');

        expect(trimStack(stack, cwd)).toEqual([
            `at OrderService.addItem (${path.join('src', 'order.service.ts')}:12:5)`,
            `at ${path.join('src', 'index.ts')}:3:1`,
        ]);
    });

    it('reads frames with file URLs', () => {
        const url = pathToFileURL(file('src', 'plugin.mjs')).href;
        expect(trimStack(`Error: x\n    at run (${url}:4:2)`, cwd)).toEqual([
            `at run (${path.join('src', 'plugin.mjs')}:4:2)`,
        ]);
    });

    it('drops a sibling directory whose name starts with cwd', () => {
        expect(trimStack(`Error: x\n    at run (${path.resolve('/app-other', 'a.ts')}:1:1)`, cwd)).toEqual(
            [],
        );
    });

    it('returns no frames for a missing stack', () => {
        expect(trimStack(undefined, cwd)).toEqual([]);
    });
});
