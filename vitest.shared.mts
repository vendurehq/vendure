/**
 * Shared settings for package unit-test suites.
 *
 * In CI, `lerna run test` runs several package suites concurrently on a low-core
 * runner, so no single suite can assume an uncontended machine:
 *
 * - vitest's default 5s `testTimeout` produces spurious timeouts under CPU
 *   contention, so tests get generous headroom in CI.
 * - each vitest process sizes its worker pool to all available cores, which
 *   oversubscribes the runner several-fold when suites run concurrently. One
 *   worker per suite keeps the total process count aligned with the runner's
 *   cores — lerna already provides the cross-package parallelism.
 */
export const sharedTestConfig = {
    testTimeout: process.env.CI ? 30 * 1000 : 15 * 1000,
    maxWorkers: process.env.CI ? 1 : undefined,
};
