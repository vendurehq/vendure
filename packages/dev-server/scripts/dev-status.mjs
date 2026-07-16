import { getActiveDevStatus, getDevStatusPath } from './dev-state.mjs';

const json = process.argv.includes('--json');
const wait = process.argv.includes('--wait');
const timeoutIndex = process.argv.indexOf('--timeout');
const timeoutSeconds = timeoutIndex === -1 ? 300 : Number(process.argv[timeoutIndex + 1]);

if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    console.error('--timeout must be a positive number of seconds.');
    process.exit(1);
}

const statusPath = getDevStatusPath();
const deadline = Date.now() + timeoutSeconds * 1000;
const startupDeadline = Math.min(deadline, Date.now() + 5_000);
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
    await new Promise(resolve => setTimeout(resolve, 250));
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
