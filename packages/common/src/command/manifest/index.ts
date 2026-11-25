/**
 * The manifest build step and merge. A package that declares commands with `defineCommand` builds
 * its `vendure-commands.json` with `writeCommandManifest`, and the host merges the manifests of a
 * project with `mergeManifests`.
 *
 * This entry point uses `node:fs`, so only Node code imports it. Browser code, such as the
 * Dashboard, imports `@vendure/common/lib/command` instead.
 */
export * from './build';
export * from './manifest';
