import { getActiveDevStatus, getDevStatusPath, isProcessAlive } from './dev-state.mjs';

const statusPath = getDevStatusPath();
const status = getActiveDevStatus({ statusPath });

if (!status) {
    console.log('No agent dev server is running for this worktree.');
    process.exit(0);
}

console.log(`Stopping agent dev server (PID ${status.pid})...`);
try {
    process.kill(status.pid, 'SIGTERM');
} catch (error) {
    if (error?.code === 'ESRCH') {
        console.log('Agent dev server was already stopped.');
        process.exit(0);
    }
    if (error?.code === 'EPERM') {
        console.error(
            `Permission denied while stopping PID ${status.pid}. Run dev:stop with the same permissions used to start dev:agent.`,
        );
        process.exit(1);
    }
    throw error;
}

const deadline = Date.now() + 15_000;
while (isProcessAlive(status.pid) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
}

if (isProcessAlive(status.pid)) {
    console.error(`Agent dev server PID ${status.pid} did not stop within 15 seconds.`);
    process.exit(1);
}

console.log('Agent dev server stopped.');
