import { LogLine } from '@vendure/common/lib/log';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { stripAnsi } from '../../shared/strip-ansi.js';

import { ExplainOutput, explainRequest, findRequestError, render } from './explain.js';
import * as schemas from './explain.schema.js';

const directories: string[] = [];

afterEach(() => {
    for (const dir of directories.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function projectWithLog(files: Record<string, Array<LogLine | string>>): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-explain-'));
    directories.push(dir);
    mkdirSync(path.join(dir, '.vendure', 'logs'), { recursive: true });
    for (const [name, lines] of Object.entries(files)) {
        writeFileSync(
            path.join(dir, '.vendure', 'logs', name),
            lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
        );
    }
    return dir;
}

const line = (overrides: Partial<LogLine>): LogLine => ({
    ts: '2026-11-24T10:00:00.000Z',
    level: 'info',
    msg: 'a line',
    process: 'server',
    ...overrides,
});

describe('explainRequest()', () => {
    it('collects the coded error and every line of the request, across rotated files', () => {
        const projectDir = projectWithLog({
            'dev.1.jsonl': [line({ requestId: 'r-1', msg: 'Resolving product' })],
            'dev.jsonl': [
                line({ requestId: 'r-2', level: 'error', msg: 'another request', code: 'core.forbidden' }),
                'not json',
                line({
                    requestId: 'r-1',
                    level: 'error',
                    msg: JSON.stringify(
                        {
                            message: 'INTERNAL_SERVER_ERROR: error.entity-with-id-not-found',
                            variables: { entityName: 'Product', id: '99' },
                        },
                        null,
                        2,
                    ),
                    code: 'core.entity-with-id-not-found',
                    stack: 'Error: ...\n    at ProductResolver (src/product.ts:10:5)',
                }),
                line({ requestId: 'r-1', process: 'worker', msg: 'job done' }),
            ],
        });

        expect(explainRequest(projectDir, 'r-1')).toEqual({
            requestId: 'r-1',
            hasLog: true,
            found: true,
            error: {
                code: 'core.entity-with-id-not-found',
                message: 'INTERNAL_SERVER_ERROR: error.entity-with-id-not-found',
                variables: { entityName: 'Product', id: '99' },
                stack: 'Error: ...\n    at ProductResolver (src/product.ts:10:5)',
                process: 'server',
                ts: '2026-11-24T10:00:00.000Z',
            },
            logs: [
                line({ requestId: 'r-1', msg: 'Resolving product' }),
                expect.objectContaining({ code: 'core.entity-with-id-not-found' }),
                line({ requestId: 'r-1', process: 'worker', msg: 'job done' }),
            ],
            omitted: 0,
        });
    });

    it('reports found: false when no line has the request ID', () => {
        const projectDir = projectWithLog({ 'dev.jsonl': [line({ requestId: 'r-2' })] });

        const output = explainRequest(projectDir, 'r-1');

        expect(output).toEqual({
            requestId: 'r-1',
            hasLog: true,
            found: false,
            error: null,
            logs: [],
            omitted: 0,
        });
        expect(render(output)).toContain('No line of the dev log');
    });

    it('reports that there is no dev log, rather than an unknown request', () => {
        const output = explainRequest(projectWithLog({}), 'r-1');

        expect(output).toMatchObject({ hasLog: false, found: false });
        expect(render(output)).toContain('This project has no dev log');
    });
});

describe('findRequestError()', () => {
    it('prefers a coded error to an earlier coded warning', () => {
        const error = findRequestError([
            line({ level: 'warn', code: 'core.forbidden', msg: 'warned' }),
            line({ level: 'error', msg: 'uncoded error' }),
            line({ level: 'error', code: 'core.unexpected', msg: 'crashed' }),
        ]);

        expect(error).toMatchObject({ code: 'core.unexpected', message: 'crashed' });
    });

    it('falls back to the first coded warning', () => {
        const error = findRequestError([
            line({ level: 'info', code: 'core.x' }),
            line({ level: 'warn', code: 'core.forbidden', msg: 'FORBIDDEN: error.forbidden' }),
        ]);

        expect(error).toEqual({
            code: 'core.forbidden',
            message: 'FORBIDDEN: error.forbidden',
            process: 'server',
            ts: '2026-11-24T10:00:00.000Z',
        });
    });

    it('falls back to a coded line at any level, such as an info-level authentication error', () => {
        const error = findRequestError([
            line({ level: 'debug', msg: 'stack' }),
            line({ level: 'info', code: 'core.unauthorized', msg: 'UNAUTHORIZED: error.unauthorized' }),
        ]);

        expect(error).toMatchObject({ code: 'core.unauthorized' });
    });

    it('is null when no line has a code', () => {
        expect(findRequestError([line({ level: 'error', msg: 'uncoded' })])).toBeNull();
    });
});

describe('render()', () => {
    it('shows the code, the message, the stack and the lines', () => {
        const text = stripAnsi(
            render({
                requestId: 'r-1',
                hasLog: true,
                found: true,
                error: { code: 'core.forbidden', message: 'Forbidden', stack: 'at x', ts: '' },
                logs: [line({ requestId: 'r-1', msg: 'Resolving' })],
                omitted: 2,
            }),
        );

        expect(text).toContain('error (core.forbidden) Forbidden');
        // The stack's line is among the omitted ones, so the header shows it.
        expect(text).toContain('at x');
        expect(text).toContain('(2 older lines left out)');
        expect(text).toContain('[server]');
        expect(text).toContain('Resolving');
    });
});

describe('render() without a coded error', () => {
    it('says that some errors are only logged at the verbose level', () => {
        const text = render({
            requestId: 'r-1',
            hasLog: true,
            found: true,
            error: null,
            logs: [line({ requestId: 'r-1' })],
            omitted: 0,
        });

        expect(stripAnsi(text)).toContain('logged at the verbose level');
    });

    it('shows the stack once, below its line, when the line is shown', () => {
        const errorLine = line({ level: 'error', code: 'core.x', msg: 'boom', stack: 'at y' });
        const text = stripAnsi(
            render({
                requestId: 'r-1',
                hasLog: true,
                found: true,
                error: findRequestError([errorLine]),
                logs: [errorLine],
                omitted: 0,
            }),
        );

        expect(text.split('at y').length - 1).toBe(1);
    });
});

describe('explain schema', () => {
    it('declares an output schema that matches the TypeScript type', () => {
        expectTypeOf<z.infer<typeof schemas.output>>().toEqualTypeOf<ExplainOutput>();
    });
});
