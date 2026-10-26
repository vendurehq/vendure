/**
 * Re-exports from @nestjs/graphql's internal dist layout, so that files which only
 * need the decorators or the execution-context helper do not load the package
 * barrel, which eagerly pulls in the drivers, federation and @graphql-tools
 * machinery at require time.
 *
 * The dist paths are not a documented public API of @nestjs/graphql. Since v14 the
 * package ships an `exports` map, so the specifiers below have to name a file that
 * the `"./*": "./*"` entry can map to; a bare directory no longer resolves. If an
 * upgrade moves these files, this module is the single place to fix.
 */
// eslint-disable-next-line no-restricted-imports
export {
    Args,
    Mutation,
    Parent,
    Query,
    ResolveField,
    Resolver,
} from '@nestjs/graphql/dist/decorators/index.js';
// eslint-disable-next-line no-restricted-imports
export { GqlExecutionContext } from '@nestjs/graphql/dist/services/gql-execution-context.js';
