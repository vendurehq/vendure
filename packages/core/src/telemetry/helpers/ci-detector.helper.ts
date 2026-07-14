/**
 * CI environment variables to check for.
 * These are standard environment variables set by popular CI/CD systems.
 * Exported for testing purposes.
 *
 * Note: hosting platforms such as Vercel and Netlify are intentionally NOT
 * included here. Their `VERCEL` / `NETLIFY` flags are set at application
 * runtime, not just during builds, so treating them as CI would suppress
 * telemetry for every production deployment on those platforms. Build-only
 * signals such as `NOW_BUILDER` (Vercel build step) are kept, since they are
 * never present when the server is actually running.
 */
export const CI_ENV_VARS = [
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'TRAVIS',
    'JENKINS_URL',
    'BUILDKITE',
    'DRONE',
    'TEAMCITY_VERSION',
    'BITBUCKET_BUILD_NUMBER',
    'TF_BUILD',
    'CODEBUILD_BUILD_ID',
    'HEROKU_TEST_RUN_ID',
    'APPVEYOR',
    'NOW_BUILDER',
];

/**
 * Detects if the current process is running in a CI/CD environment.
 * Returns true if any known CI environment variable is set.
 */
export function isCI(): boolean {
    return CI_ENV_VARS.some(envVar => {
        const value = process.env[envVar];
        return value !== undefined && value !== '' && value !== 'false' && value !== '0';
    });
}
