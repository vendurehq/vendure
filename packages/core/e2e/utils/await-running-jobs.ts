import { SimpleGraphQLClient } from '@vendure/testing';

import { GetRunningJobsQuery, GetRunningJobsQueryVariables } from '../graphql/generated-e2e-admin-types';
import { getRunningJobsDocument } from '../graphql/shared-definitions';

/**
 * For mutations which trigger background jobs, this "pauses" the test until those jobs have
 * completed.
 *
 * The jobs are not enqueued synchronously with the triggering mutation: the subscribers run
 * after the transaction commits (via the EventBus), and some paths debounce by up to 50ms. So
 * checking the queue once and stopping at the first empty result is unsafe — the job may simply
 * not have been enqueued yet, and the assertion then runs against a stale index.
 *
 * Instead we wait until the queue has been continuously empty for a confirmation window; any
 * in-flight job resets that window. The initial call counts as activity, so an empty queue must
 * still stay empty for the full window before we trust it — this catches jobs that appear after
 * we start polling. The window is sized above the search plugin's 50ms collection debounce and
 * widened under CI load, where enqueue latency is highest.
 */
export async function awaitRunningJobs(
    adminClient: SimpleGraphQLClient,
    timeout: number = 5000,
    confirmMs: number = defaultConfirmMs(),
    pollMs = 50,
) {
    const startTime = Date.now();
    // The last time we saw unsettled jobs. Seeded with the start time so that a queue which is
    // already empty must remain empty for the whole confirmation window before we return.
    let lastActivity = startTime;

    for (;;) {
        const runningJobs = await queryRunningJobs(adminClient);
        const now = Date.now();
        if (runningJobs > 0) {
            lastActivity = now;
        } else if (now - lastActivity >= confirmMs) {
            return;
        }
        if (now - startTime >= timeout) {
            throw new Error(
                `awaitRunningJobs timed out after ${timeout}ms with ${runningJobs} job(s) still running`,
            );
        }
        await sleep(pollMs);
    }
}

/**
 * The confirmation window must comfortably exceed the largest enqueue delay in the system (the
 * search plugin buffers collection updates with a 50ms debounce) plus the event-emission latency,
 * which grows under CI load. Overridable via `E2E_AWAIT_JOBS_CONFIRM_MS` for tuning and for
 * exercising the race in tests (a value of 0 reproduces the historic flaky behaviour).
 */
function defaultConfirmMs(): number {
    if (process.env.E2E_AWAIT_JOBS_CONFIRM_MS !== undefined) {
        return +process.env.E2E_AWAIT_JOBS_CONFIRM_MS;
    }
    return process.env.CI ? 500 : 200;
}

async function queryRunningJobs(adminClient: SimpleGraphQLClient): Promise<number> {
    const { jobs } = await adminClient.query<GetRunningJobsQuery, GetRunningJobsQueryVariables>(
        getRunningJobsDocument,
        { options: { filter: { isSettled: { eq: false } } } },
    );
    return jobs.totalItems;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
