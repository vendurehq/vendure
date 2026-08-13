export const PROCESS_STOP_GRACE_PERIOD_MS = 15_000;
export const PROCESS_STOP_POLL_INTERVAL_MS = 250;

export async function terminateProcess({
    pid,
    processIsAlive,
    sendSignal = (processId, signal) => process.kill(processId, signal),
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    gracePeriodMs = PROCESS_STOP_GRACE_PERIOD_MS,
    pollIntervalMs = PROCESS_STOP_POLL_INTERVAL_MS,
}) {
    sendSignal(pid, 'SIGTERM');

    const deadline = Date.now() + gracePeriodMs;
    while (processIsAlive(pid) && Date.now() < deadline) {
        await wait(pollIntervalMs);
    }

    if (!processIsAlive(pid)) {
        return { forced: false };
    }

    sendSignal(pid, 'SIGKILL');
    return { forced: true };
}
