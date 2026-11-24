import { LogLine } from '@vendure/common/lib/log';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stripAnsi } from '../../shared/strip-ansi.js';

import { explainRequest, findRequestError, render } from './explain.js';

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
                    msg: 'No Product with the id "99" could be found',
                    code: 'core.entity-with-id-not-found',
                    stack: 'Error: ...\n    at ProductResolver (src/product.ts:10:5)',
                }),
                line({ requestId: 'r-1', process: 'worker', msg: 'job done' }),
            ],
        });

        expect(explainRequest(projectDir, 'r-1')).toEqual({
            requestId: 'r-1',
            found: true,
            error: {
                code: 'core.entity-with-id-not-found',
                message: 'No Product with the id "99" could be found',
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

        expect(output).toEqual({ requestId: 'r-1', found: false, error: null, logs: [], omitted: 0 });
        expect(render(output)).toContain('.vendure/logs/dev.jsonl');
    });

    it('reports found: false when there is no dev log', () => {
        expect(explainRequest(projectWithLog({}), 'r-1').found).toBe(false);
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
            line({ level: 'warn', code: 'core.forbidden', msg: 'warned' }),
        ]);

        expect(error).toEqual({
            code: 'core.forbidden',
            message: 'warned',
            process: 'server',
            ts: '2026-11-24T10:00:00.000Z',
        });
    });

    it('is null when no error or warning has a code', () => {
        expect(findRequestError([line({ level: 'error', msg: 'uncoded' })])).toBeNull();
    });
});

describe('render()', () => {
    it('shows the code, the message, the stack and the lines', () => {
        const text = stripAnsi(
            render({
                requestId: 'r-1',
                found: true,
                error: { code: 'core.forbidden', message: 'Forbidden', stack: 'at x', ts: '' },
                logs: [line({ requestId: 'r-1', msg: 'Resolving' })],
                omitted: 2,
            }),
        );

        expect(text).toContain('error (core.forbidden) Forbidden');
        expect(text).toContain('at x');
        expect(text).toContain('(2 older lines left out)');
        expect(text).toContain('[server]');
        expect(text).toContain('Resolving');
    });
});
