import { writeSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from './errors';
import { toStartupErrorEvent, writeStartupErrorEvent } from './startup-error-event';
import { VendureStartupError } from './vendure-startup-error';

vi.mock('node:fs', async importOriginal => ({
    ...(await importOriginal<typeof import('node:fs')>()),
    writeSync: vi.fn(),
}));

describe('toStartupErrorEvent()', () => {
    it('carries the code and fixes of a VendureStartupError', () => {
        const error = new VendureStartupError({
            code: 'core.config.invalid-custom-fields',
            message: 'CustomFields config error',
            fix: [{ description: 'Correct the custom field' }],
        });

        expect(toStartupErrorEvent(error)).toEqual({
            vendure: 'event',
            event: 'startup-error',
            code: 'core.config.invalid-custom-fields',
            message: 'CustomFields config error',
            fix: [{ description: 'Correct the custom field' }],
        });
    });

    it('uses the vendureCode of an I18nError', () => {
        expect(toStartupErrorEvent(new ForbiddenError())).toMatchObject({ code: 'core.forbidden', fix: [] });
    });

    it('gives any other error the unexpected code', () => {
        expect(toStartupErrorEvent(new Error('boom'))).toMatchObject({
            code: 'core.unexpected',
            message: 'boom',
            fix: [],
        });
        expect(toStartupErrorEvent('boom')).toMatchObject({ code: 'core.unexpected', message: 'boom' });
    });

    it('serializes to one line', () => {
        const error = new VendureStartupError({ code: 'core.config.x', message: 'line one\nline two' });
        expect(JSON.stringify(toStartupErrorEvent(error))).not.toContain('\n');
    });
});

describe('writeStartupErrorEvent()', () => {
    const writeSyncMock = vi.mocked(writeSync);

    afterEach(() => {
        writeSyncMock.mockReset();
    });

    /** Records what each call writes, writing at most `chunkSize` bytes per call. */
    function recordWrites(chunkSize: number) {
        const written: Buffer[] = [];
        writeSyncMock.mockImplementation(((fd: number, buffer: Buffer, offset: number) => {
            const chunk = buffer.subarray(offset, offset + chunkSize);
            written.push(chunk);
            return chunk.length;
        }) as any);
        return () => Buffer.concat(written).toString();
    }

    it('writes the rest of the line after a partial write', () => {
        const output = recordWrites(7);
        writeStartupErrorEvent(new Error('boom'));

        expect(writeSyncMock.mock.calls.length).toBeGreaterThan(1);
        expect(output().endsWith('\n')).toBe(true);
        expect(JSON.parse(output())).toMatchObject({ event: 'startup-error', message: 'boom' });
    });

    it('retries while the pipe refuses the write with EAGAIN', () => {
        const output = recordWrites(1024);
        const eagain = Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' });
        writeSyncMock.mockImplementationOnce(() => {
            throw eagain;
        });
        writeStartupErrorEvent(new Error('boom'));

        expect(JSON.parse(output())).toMatchObject({ message: 'boom' });
    });
});
