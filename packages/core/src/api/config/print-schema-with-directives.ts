import { GraphQLSchema } from 'graphql';

/**
 * Like `printSchema()`, but keeps directives applied to fields, such as `@nonBlank`, which
 * `printSchema()` drops. The Dashboard reads `@nonBlank` from the printed schema.
 *
 * Kept in its own module, which `api/index.ts` does not re-export, so that it is not part of the
 * public API of `@vendure/core`.
 */
export function printSchemaWithDirectives(schema: GraphQLSchema): string {
    // Required lazily so that @graphql-tools/utils is not loaded at require time of @vendure/core.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@graphql-tools/utils').printSchemaWithDirectives(schema);
}
