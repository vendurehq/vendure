import { AGENT_GUIDE } from './guide.content.js';

/** The agent guide of the installed CLI. */
export function run() {
    return Promise.resolve({ guide: AGENT_GUIDE });
}
