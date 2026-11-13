import assert from 'node:assert/strict';
import test from 'node:test';

import { terminateProcess } from './process-termination.mjs';

test('stops a responsive process with SIGTERM', async () => {
    const signals = [];
    let alive = true;
    const result = await terminateProcess({
        pid: 123,
        processIsAlive: () => alive,
        sendSignal: (_pid, signal) => {
            signals.push(signal);
            alive = false;
        },
        wait: async () => undefined,
    });

    assert.deepEqual(signals, ['SIGTERM']);
    assert.deepEqual(result, { forced: false });
});

test('escalates to SIGKILL after the grace period', async () => {
    const signals = [];
    const result = await terminateProcess({
        pid: 123,
        processIsAlive: () => true,
        sendSignal: (_pid, signal) => signals.push(signal),
        gracePeriodMs: 0,
        wait: async () => undefined,
    });

    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    assert.deepEqual(result, { forced: true });
});
