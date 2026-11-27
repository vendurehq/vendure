export const REQUIRED_NODE_VERSION = '>=22.12.0';
/**
 * Oldest Node.js major release that has not reached end-of-life. Used to warn (not block)
 * users on EOL versions, for which native deps often stop publishing prebuilt binaries.
 * Bump when the oldest maintained LTS goes EOL: https://nodejs.org/en/about/previous-releases
 */
export const OLDEST_NON_EOL_NODE_MAJOR = 22;
/** The port `vendure dev` serves the API on, which the storefront's env file points at. */
export const SERVER_PORT = 3000;
export const STOREFRONT_PORT = 3001;
/**
 * The `@vendure/cloud` range a generated project depends on. It is bumped by hand when a
 * `@vendure/cloud` release is needed by what create writes, and a test pins it. The `-0` lower
 * bound also accepts the 0.9.0 prereleases, such as `0.9.0-dev.*`, which `^0.9.0` does not.
 */
export const CLOUD_PACKAGE_RANGE = '>=0.9.0-0 <0.10.0';
/**
 * The TypeScript version needs to pinned because minor versions often
 * introduce breaking changes.
 */
export const TYPESCRIPT_VERSION = '5.8.2';
/**
 * Generated migration files import `MigrationInterface`/`QueryRunner` directly from `typeorm`.
 * pnpm's strict, non-hoisting `node_modules` does not expose `typeorm` (a transitive dep of
 * `@vendure/core`), so pnpm-scaffolded projects must declare it directly. Must stay equal to the
 * range `@vendure/core` depends on so pnpm dedupes to a single instance - a mismatch would produce
 * duplicate TypeORM copies with separate decorator metadata. Enforced by a test in project-files.spec.ts.
 */
export const TYPEORM_VERSION = '^0.3.21 || ^1.1.2';
/**
 * The Dashboard build that `vendure dev` runs needs `vite` as a direct dependency, because strict
 * (non-hoisting) package managers like pnpm don't expose transitive deps. The range tracks
 * @vendure/dashboard's declaration, so the project stays on the same Vite major as the Dashboard.
 */
export const VITE_VERSION = '^8.3.5';
/** The local services `vendure dev` starts are PostgreSQL and Redis, reached through these. */
export const PG_VERSION = '^8.16.0';
export const IOREDIS_VERSION = '^5.3.2';
export const TS_NODE_VERSION = '^10.9.2';
export const TYPES_NODE_VERSION = '^22.20.1';
/**
 * `concurrently` runs the monorepo root's `dev` script. The major is pinned because its
 * command-line behaviour could change across majors.
 */
export const CONCURRENTLY_VERSION = '^9.0.0';
export const DEFAULT_PROJECT_VERSION = '0.1.0';
/** The docs page on running Vendure on your own infrastructure. */
export const SELF_HOSTING_GUIDE_URL = 'https://docs.vendure.io/current/framework/deployment/self-hosting';
