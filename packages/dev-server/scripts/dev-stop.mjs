import { getActiveDevStatus, getDevStatusPath, isProcessAlive } from './dev-state.mjs';
import { terminateProcess } from './process-termination.mjs';

const statusPath = getDevStatusPath();
const status = getActiveDevStatus({ statusPath });

if (!status) {
    console.log('No agent dev server is running for this worktree.');
    process.exit(0);
}

console.log(`Stopping agent dev server (PID ${status.pid})...`);
try {
    const result = await terminateProcess({
        pid: status.pid,
        processIsAlive: isProcessAlive,
    });
    if (result.forced) {
        console.error(`Agent dev server PID ${status.pid} required SIGKILL after 15 seconds.`);
        process.exit(1);
    }
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

console.log('Agent dev server stopped.');
