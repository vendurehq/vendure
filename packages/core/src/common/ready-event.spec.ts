import { writeSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeReadyEvent } from './ready-event';

vi.mock('node:fs', async importOriginal => ({
    ...(await importOriginal<typeof import('node:fs')>()),
    writeSync: vi.fn((fd: number, buffer: Buffer, offset: number) => buffer.length - offset),
}));

describe('writeReadyEvent()', () => {
    const writeSyncMock = vi.mocked(writeSync);

    afterEach(() => {
        writeSyncMock.mockClear();
    });

    function writtenLine(): string {
        const [fd, buffer] = writeSyncMock.mock.calls[0] as unknown as [number, Buffer];
        expect(fd).toBe(process.stderr.fd);
        return buffer.toString();
    }

    it('writes the server event with its URLs as one line of JSON to stderr', () => {
        writeReadyEvent(
            'server',
            { admin: 'http://localhost:3000/admin-api', shop: 'http://localhost:3000/shop-api' },
            [{ label: 'Dashboard UI', url: 'http://localhost:3000/dashboard' }],
        );

        const line = writtenLine();
        expect(line.endsWith('\n')).toBe(true);
        expect(line.trimEnd()).not.toContain('\n');
        expect(JSON.parse(line)).toEqual({
            vendure: 'event',
            event: 'ready',
            process: 'server',
            urls: { admin: 'http://localhost:3000/admin-api', shop: 'http://localhost:3000/shop-api' },
            routes: [{ label: 'Dashboard UI', url: 'http://localhost:3000/dashboard' }],
        });
    });

    it('writes the worker event without URLs', () => {
        writeReadyEvent('worker');

        expect(JSON.parse(writtenLine())).toEqual({ vendure: 'event', event: 'ready', process: 'worker' });
    });
});
