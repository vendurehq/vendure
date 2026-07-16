import { getActiveDevStatus, getDevStatusPath } from './dev-state.mjs';

const DEFAULT_STATUS_TIMEOUT_SECONDS = 300;
const STATUS_STARTUP_DEADLINE_MS = 5_000;
const STATUS_POLL_INTERVAL_MS = 250;
const json = process.argv.includes('--json');
const wait = process.argv.includes('--wait');
const timeoutIndex = process.argv.indexOf('--timeout');
const timeoutSeconds =
    timeoutIndex === -1 ? DEFAULT_STATUS_TIMEOUT_SECONDS : Number(process.argv[timeoutIndex + 1]);

if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    console.error('--timeout must be a positive number of seconds.');
    process.exit(1);
}

const statusPath = getDevStatusPath();
const deadline = Date.now() + timeoutSeconds * 1000;
const startupDeadline = Math.min(deadline, Date.now() + STATUS_STARTUP_DEADLINE_MS);
let status;
let observedActiveProcess = false;

do {
    status = getActiveDevStatus({ statusPath });
    if (status) {
        observedActiveProcess = true;
    }
    if (
        !wait ||
        status?.status === 'ready' ||
        status?.status === 'failed' ||
        (observedActiveProcess && !status) ||
        (!observedActiveProcess && !status && Date.now() >= startupDeadline)
    ) {
        break;
    }
    await new Promise(resolve => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
} while (Date.now() < deadline);

if (!status) {
    output({
        status: 'stopped',
        statusFile: statusPath,
    });
    process.exitCode = 1;
} else if (status.status === 'failed') {
    output({
        ...status,
        statusFile: statusPath,
    });
    process.exitCode = 1;
} else if (wait && status.status !== 'ready') {
    output({
        ...status,
        statusFile: statusPath,
        error: `Timed out after ${timeoutSeconds} seconds waiting for readiness.`,
    });
    process.exitCode = 1;
} else {
    output({
        ...status,
        statusFile: statusPath,
    });
}

function output(value) {
    if (json) {
        console.log(JSON.stringify(value));
        return;
    }
    console.log(`Status:           ${value.status}`);
    if (value.pid) {
        console.log(`PID:              ${value.pid}`);
    }
    if (value.apiUrl) {
        console.log(`API:              ${value.apiUrl}`);
        console.log(`Dashboard:        ${value.dashboardUrl}`);
        console.log(`Server Dashboard: ${value.serverDashboardUrl}`);
    }
    console.log(`Status file:      ${value.statusFile}`);
    if (value.error) {
        console.error(value.error);
    }
}
