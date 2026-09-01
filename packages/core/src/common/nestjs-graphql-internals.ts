/**
 * Re-exports from @nestjs/graphql's internal dist layout, so that files which only
 * need the decorators or the execution-context helper do not load the package
 * barrel, which eagerly pulls in the drivers, federation and @graphql-tools
 * machinery at require time.
 *
 * The dist paths are not a documented public API of @nestjs/graphql (the package
 * currently ships no `exports` map, so they resolve). If an upgrade moves these
 * files, this module is the single place to fix.
 */
// eslint-disable-next-line no-restricted-imports
export { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql/dist/decorators';
// eslint-disable-next-line no-restricted-imports
export { GqlExecutionContext } from '@nestjs/graphql/dist/services/gql-execution-context';
