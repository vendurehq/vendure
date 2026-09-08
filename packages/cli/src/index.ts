/**
 * The public API of `@vendure/cli`. Everything exported here can be imported from
 * `@vendure/cli` by a package that composes the CLI commands into a CLI of its own.
 * Anything not exported here is internal and may change in any release.
 */
export { devCommand } from './commands/dev/dev';
export type { DevOptions, DevTarget } from './commands/dev/dev';
