import { describe, expect, it, vi } from 'vitest';

import { DevSupervisor } from './supervisor.js';

const now = () => new Date('2026-11-22T10:00:00.000Z');
const compileError = {
    process: 'server',
    message: 'The server failed to compile: 1 compile error',
    diagnostics: [{ file: 'src/index.ts', line: 1, column: 7, message: 'Bad', code: 'TS2322' }],
};

describe('DevSupervisor', () => {
    it('is starting until every process is ready', () => {
        const supervisor = new DevSupervisor(['server', 'worker'], undefined, now);
        expect(supervisor.status).toBe('starting');

        supervisor.childReady('server');
        expect(supervisor.status).toBe('starting');

        supervisor.childReady('worker');
        expect(supervisor.snapshot()).toEqual({
            status: 'ready',
            urls: {},
            startedAt: '2026-11-22T10:00:00.000Z',
            restarts: 0,
            lastError: null,
        });
    });

    it('fails when a process fails, and stays failed until a restart makes it ready', () => {
        const onChange = vi.fn();
        const supervisor = new DevSupervisor(['server', 'worker'], onChange, now);
        supervisor.childReady('worker');
        supervisor.childFailed('server', compileError);

        expect(supervisor.snapshot()).toMatchObject({ status: 'failed', lastError: compileError });
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));

        supervisor.childRestarting('server');
        expect(supervisor.status).toBe('restarting');
        supervisor.childReady('server');
        expect(supervisor.snapshot()).toMatchObject({ status: 'ready', restarts: 1, lastError: null });
    });

    it('reports failed over restarting while another process is still failed', () => {
        const supervisor = new DevSupervisor(['server', 'worker'], undefined, now);
        supervisor.childReady('server');
        supervisor.childFailed('worker', { process: 'worker', message: 'The worker exited with code 1' });
        supervisor.childRestarting('server');

        expect(supervisor.status).toBe('failed');
    });

    it('counts the restarts of one change as one', () => {
        let time = Date.parse('2026-11-22T10:00:00.000Z');
        const supervisor = new DevSupervisor(['server', 'worker'], undefined, () => new Date(time));
        supervisor.childReady('server');
        supervisor.childReady('worker');

        supervisor.childRestarting('server');
        supervisor.childRestarting('worker');
        supervisor.childReady('server');
        supervisor.childReady('worker');
        expect(supervisor.snapshot().restarts).toBe(1);

        time += 5000;
        supervisor.childRestarting('server');
        supervisor.childReady('server');
        expect(supervisor.snapshot().restarts).toBe(2);
    });

    it('counts a later change while a process still restarts from an earlier one', () => {
        let time = Date.parse('2026-11-22T10:00:00.000Z');
        const supervisor = new DevSupervisor(['server', 'worker'], undefined, () => new Date(time));
        supervisor.childReady('server');
        supervisor.childReady('worker');

        supervisor.childRestarting('worker');
        supervisor.childRestarting('server');
        supervisor.childFailed('server', compileError);
        expect(supervisor.snapshot().restarts).toBe(1);

        // The fix for the compile error is saved while the worker is still restarting.
        time += 2000;
        supervisor.childRestarting('server');
        expect(supervisor.snapshot().restarts).toBe(2);
    });

    it('counts restarts once when a failed process and a ready one restart together', () => {
        const supervisor = new DevSupervisor(['server', 'worker'], undefined, now);
        supervisor.childReady('server');
        supervisor.childFailed('worker', { process: 'worker', message: 'crash' });
        supervisor.childRestarting('server');
        supervisor.childRestarting('worker');

        expect(supervisor.snapshot().restarts).toBe(1);
    });

    it('collects the URLs the processes report', () => {
        const supervisor = new DevSupervisor(['server'], undefined, now);
        supervisor.addUrls({ shop: 'http://localhost:3000/shop-api' });
        supervisor.addUrls({ admin: 'http://localhost:3000/admin-api' });

        expect(supervisor.snapshot().urls).toEqual({
            shop: 'http://localhost:3000/shop-api',
            admin: 'http://localhost:3000/admin-api',
        });
    });

    it('is stopped once stopped, and ignores later reports', () => {
        const supervisor = new DevSupervisor(['server'], undefined, now);
        supervisor.stop();
        supervisor.childReady('server');
        supervisor.childFailed('server', compileError);

        expect(supervisor.snapshot()).toMatchObject({ status: 'stopped', lastError: null });
    });
});
